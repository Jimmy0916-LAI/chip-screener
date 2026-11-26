package tw.chipscreener.mobile;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * ChipScreener Android 原生安全外掛：
 * - 私有目錄原子檔案讀寫（路徑遍歷防護 + fsync + rename）
 * - Android Keystore AES-256-GCM 加密金庫（存放 Gemini API Key 等敏感資訊）
 * - HTTPS 白名單原生網路層（禁止明文 HTTP、逐跳驗證重新導向目標、16MB 上限）
 * - 僅限 HTTPS 的系統外部瀏覽器開啟
 */
@CapacitorPlugin(name = "ChipNative")
public class ChipNativePlugin extends Plugin {
    private static final String KEY_ALIAS = "ChipScreenerVaultKeyV1";
    private static final String VAULT_PREFS = "chip_vault_v1";
    private static final int MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
    private static final int MAX_REDIRECTS = 5;
    private static final int GCM_IV_LEN = 12;
    private static final int GCM_TAG_BITS = 128;

    private static final Set<String> ALLOWED_HOSTS = new HashSet<>(Arrays.asList(
            "opendata.tdcc.com.tw",
            "www.twse.com.tw",
            "api.finmindtrade.com",
            "query1.finance.yahoo.com",
            "query2.finance.yahoo.com",
            "tw.stock.yahoo.com",
            "feeds.feedburner.com",
            "search.cnbc.com",
            "generativelanguage.googleapis.com"
    ));

    private final ExecutorService ioPool = Executors.newFixedThreadPool(8);

    @Override
    protected void handleOnDestroy() {
        ioPool.shutdownNow();
        super.handleOnDestroy();
    }

    private File getBaseDir() throws IOException {
        File dir = new File(getContext().getFilesDir(), "chipscreener");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("無法建立私有資料目錄");
        }
        return dir.getCanonicalFile();
    }

    private File resolveSafePath(String relPath) throws IOException {
        if (relPath == null || relPath.isEmpty() || relPath.length() > 200 || relPath.startsWith("/")) {
            throw new SecurityException("儲存路徑無效");
        }
        File base = getBaseDir();
        File target = new File(base, relPath).getCanonicalFile();
        String basePath = base.getPath();
        String targetPath = target.getPath();
        if (!targetPath.equals(basePath) && !targetPath.startsWith(basePath + File.separator)) {
            throw new SecurityException("拒絕跨目錄存取");
        }
        return target;
    }

    private URL validateHttpsUrl(String raw) throws IOException {
        URL url = new URL(raw);
        if (!"https".equalsIgnoreCase(url.getProtocol())) {
            throw new SecurityException("僅允許 HTTPS 連線");
        }
        String host = url.getHost();
        if (host == null || !ALLOWED_HOSTS.contains(host.toLowerCase())) {
            throw new SecurityException("未授權網域 " + host);
        }
        if (url.getUserInfo() != null) {
            throw new SecurityException("網址不可含帳密");
        }
        return url;
    }

    /* ---------- 原子檔案系統 ---------- */

    @PluginMethod
    public void fsRead(PluginCall call) {
        String rel = call.getString("path", "");
        ioPool.execute(() -> {
            try {
                File f = resolveSafePath(rel);
                JSObject ret = new JSObject();
                if (!f.exists() || !f.isFile()) {
                    ret.put("exists", false);
                    ret.put("data", "");
                    ret.put("mtime", 0);
                    call.resolve(ret);
                    return;
                }
                byte[] buf = readAllBytes(f, MAX_RESPONSE_BYTES);
                ret.put("exists", true);
                ret.put("data", new String(buf, StandardCharsets.UTF_8));
                ret.put("mtime", f.lastModified());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("讀取失敗: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void fsWrite(PluginCall call) {
        String rel = call.getString("path", "");
        String data = call.getString("data", "");
        ioPool.execute(() -> {
            try {
                File target = resolveSafePath(rel);
                File parent = target.getParentFile();
                if (parent != null && !parent.exists() && !parent.mkdirs()) {
                    throw new IOException("無法建立父目錄");
                }
                File tmp = new File(parent, target.getName() + ".tmp." + Thread.currentThread().getId());
                byte[] bytes = data.getBytes(StandardCharsets.UTF_8);
                try (FileOutputStream fos = new FileOutputStream(tmp)) {
                    fos.write(bytes);
                    fos.getFD().sync();
                }
                if (!tmp.renameTo(target)) {
                    // Android 檔案系統極少數情況下若 renameTo 失敗，改以刪除後替換
                    if (target.exists() && !target.delete()) {
                        tmp.delete();
                        throw new IOException("無法替換目標檔案");
                    }
                    if (!tmp.renameTo(target)) {
                        tmp.delete();
                        throw new IOException("無法提交暫存檔");
                    }
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("寫入失敗: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void fsList(PluginCall call) {
        String rel = call.getString("path", "");
        ioPool.execute(() -> {
            try {
                File dir = resolveSafePath(rel);
                JSArray arr = new JSArray();
                if (dir.exists() && dir.isDirectory()) {
                    File[] children = dir.listFiles();
                    if (children != null) {
                        for (File c : children) {
                            if (!c.isFile() || c.getName().contains(".tmp")) continue;
                            JSObject item = new JSObject();
                            item.put("name", c.getName());
                            item.put("mtime", c.lastModified());
                            item.put("size", c.length());
                            arr.put(item);
                        }
                    }
                }
                JSObject ret = new JSObject();
                ret.put("files", arr);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("列舉目錄失敗: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void fsRemove(PluginCall call) {
        String rel = call.getString("path", "");
        ioPool.execute(() -> {
            try {
                File f = resolveSafePath(rel);
                if (f.exists() && f.isFile()) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("刪除失敗: " + e.getMessage());
            }
        });
    }

    private static byte[] readAllBytes(File f, int maxBytes) throws IOException {
        if (f.length() > maxBytes) throw new IOException("檔案過大");
        try (InputStream in = new FileInputStream(f);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[16384];
            int n;
            int total = 0;
            while ((n = in.read(chunk)) != -1) {
                total += n;
                if (total > maxBytes) throw new IOException("檔案過大");
                out.write(chunk, 0, n);
            }
            return out.toByteArray();
        }
    }

    /* ---------- Android Keystore AES-256-GCM 加密金庫 ---------- */

    private synchronized SecretKey getOrCreateVaultKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            KeyStore.Entry entry = ks.getEntry(KEY_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            }
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build();
        kg.init(spec);
        return kg.generateKey();
    }

    private SharedPreferences vaultPrefs() {
        return getContext().getSharedPreferences(VAULT_PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void vaultSet(PluginCall call) {
        String key = call.getString("key", "");
        String value = call.getString("value", "");
        if (!key.matches("^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$")) {
            call.reject("金庫鍵名無效");
            return;
        }
        ioPool.execute(() -> {
            try {
                SecretKey secretKey = getOrCreateVaultKey();
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, secretKey);
                byte[] iv = cipher.getIV();
                byte[] ct = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
                byte[] combined = new byte[iv.length + ct.length];
                System.arraycopy(iv, 0, combined, 0, iv.length);
                System.arraycopy(ct, 0, combined, iv.length, ct.length);
                String encoded = Base64.encodeToString(combined, Base64.NO_WRAP);
                vaultPrefs().edit().putString(key, encoded).apply();
                call.resolve();
            } catch (Exception e) {
                call.reject("金庫寫入失敗: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void vaultGet(PluginCall call) {
        String key = call.getString("key", "");
        if (!key.matches("^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$")) {
            call.reject("金庫鍵名無效");
            return;
        }
        ioPool.execute(() -> {
            try {
                String encoded = vaultPrefs().getString(key, null);
                JSObject ret = new JSObject();
                if (encoded == null || encoded.isEmpty()) {
                    ret.put("value", "");
                    call.resolve(ret);
                    return;
                }
                byte[] combined = Base64.decode(encoded, Base64.NO_WRAP);
                if (combined.length <= GCM_IV_LEN) {
                    ret.put("value", "");
                    call.resolve(ret);
                    return;
                }
                byte[] iv = Arrays.copyOfRange(combined, 0, GCM_IV_LEN);
                byte[] ct = Arrays.copyOfRange(combined, GCM_IV_LEN, combined.length);
                SecretKey secretKey = getOrCreateVaultKey();
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_BITS, iv));
                byte[] pt = cipher.doFinal(ct);
                ret.put("value", new String(pt, StandardCharsets.UTF_8));
                call.resolve(ret);
            } catch (Exception e) {
                // 若裝置重設金鑰導致解密失敗，不回傳亂碼
                JSObject ret = new JSObject();
                ret.put("value", "");
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void vaultRemove(PluginCall call) {
        String key = call.getString("key", "");
        if (!key.matches("^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$")) {
            call.reject("金庫鍵名無效");
            return;
        }
        vaultPrefs().edit().remove(key).apply();
        call.resolve();
    }

    /* ---------- HTTPS 白名單原生請求 ---------- */

    @PluginMethod
    public void httpRequest(PluginCall call) {
        String rawUrl = call.getString("url", "");
        String method = call.getString("method", "GET");
        JSObject headersObj = call.getObject("headers", new JSObject());
        String body = call.getString("body", null);
        int timeoutMs = Math.max(1000, Math.min(60000, call.getInt("timeoutMs", 12000)));

        ioPool.execute(() -> {
            HttpURLConnection conn = null;
            try {
                URL currentUrl = validateHttpsUrl(rawUrl);
                int status = 0;
                int redirects = 0;

                while (true) {
                    conn = (HttpURLConnection) currentUrl.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setRequestMethod(method);
                    conn.setConnectTimeout(timeoutMs);
                    conn.setReadTimeout(timeoutMs);
                    conn.setUseCaches(false);

                    Iterator<String> keys = headersObj.keys();
                    while (keys.hasNext()) {
                        String k = keys.next();
                        String v = headersObj.getString(k);
                        if (v != null) conn.setRequestProperty(k, v);
                    }

                    if (body != null && ("POST".equalsIgnoreCase(method) || "PUT".equalsIgnoreCase(method))) {
                        conn.setDoOutput(true);
                        byte[] outBytes = body.getBytes(StandardCharsets.UTF_8);
                        conn.setFixedLengthStreamingMode(outBytes.length);
                        try (OutputStream os = conn.getOutputStream()) {
                            os.write(outBytes);
                        }
                    }

                    status = conn.getResponseCode();
                    if ((status == 301 || status == 302 || status == 303 || status == 307 || status == 308)
                            && redirects < MAX_REDIRECTS) {
                        String loc = conn.getHeaderField("Location");
                        conn.disconnect();
                        if (loc == null || loc.isEmpty()) break;
                        currentUrl = validateHttpsUrl(new URL(currentUrl, loc).toString());
                        redirects++;
                        continue;
                    }
                    break;
                }

                InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                byte[] respBytes = new byte[0];
                if (stream != null) {
                    try (InputStream in = stream;
                         ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                        byte[] chunk = new byte[16384];
                        int n;
                        int total = 0;
                        while ((n = in.read(chunk)) != -1) {
                            total += n;
                            if (total > MAX_RESPONSE_BYTES) {
                                throw new IOException("回應過大");
                            }
                            out.write(chunk, 0, n);
                        }
                        respBytes = out.toByteArray();
                    }
                }

                JSObject respHeaders = new JSObject();
                Map<String, List<String>> hdrs = conn.getHeaderFields();
                if (hdrs != null) {
                    for (Map.Entry<String, List<String>> entry : hdrs.entrySet()) {
                        if (entry.getKey() != null && entry.getValue() != null && !entry.getValue().isEmpty()) {
                            respHeaders.put(entry.getKey().toLowerCase(), entry.getValue().get(0));
                        }
                    }
                }

                JSObject ret = new JSObject();
                ret.put("status", status);
                ret.put("headers", respHeaders);
                ret.put("bodyBase64", Base64.encodeToString(respBytes, Base64.NO_WRAP));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("連線失敗 " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    /* ---------- 外部系統瀏覽器 ---------- */

    @PluginMethod
    public void openExternal(PluginCall call) {
        String raw = call.getString("url", "");
        try {
            Uri uri = Uri.parse(raw);
            if (!"https".equalsIgnoreCase(uri.getScheme())) {
                call.reject("僅允許開啟 HTTPS 連結");
                return;
            }
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("無法開啟連結: " + e.getMessage());
        }
    }
}
