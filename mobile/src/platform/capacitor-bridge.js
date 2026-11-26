/**
 * Capacitor 原生橋接層
 * 將 CM.native 對接到自訂原生外掛 ChipNative（檔案／Keystore 金庫／HTTPS／外部瀏覽器）
 * 以及官方外掛 LocalNotifications 與 App 生命週期。
 * 若在純瀏覽器預覽（無原生外掛），會自動降級為安全無害的測試提示模式。
 */
(function (CM) {
  'use strict';

  function getPlugins() {
    const cap = globalThis.Capacitor;
    return (cap && cap.Plugins) || {};
  }

  function isNativeAndroid() {
    const cap = globalThis.Capacitor;
    return Boolean(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  }

  function createCapacitorNative() {
    const plugins = getPlugins();
    const ChipNative = plugins.ChipNative;
    const LocalNotifications = plugins.LocalNotifications;
    const AppPlugin = plugins.App;

    if (AppPlugin && typeof AppPlugin.addListener === 'function') {
      AppPlugin.addListener('appStateChange', ({ isActive }) => {
        CM.lifecycle.active = Boolean(isActive);
      });
    }

    const notifyChannelReady = (async () => {
      if (!LocalNotifications || typeof LocalNotifications.createChannel !== 'function') return;
      try {
        await LocalNotifications.createChannel({
          id: 'daily-briefing',
          name: '每日財經晨報',
          description: '每日定時提醒檢視台美股財經晨報與自選股分析',
          importance: 4,
          visibility: 1,
          vibration: true
        });
      } catch {
        // 忽略舊版或不支援通道的環境
      }
    })();

    return {
      isNative: isNativeAndroid() && Boolean(ChipNative),

      async httpRequest({ url, method = 'GET', headers = {}, json, timeoutMs = 12000 }) {
        if (!ChipNative || typeof ChipNative.httpRequest !== 'function') {
          throw new Error('連線失敗 原生網路模組未就緒');
        }
        const body = json !== undefined ? JSON.stringify(json) : undefined;
        const res = await ChipNative.httpRequest({ url, method, headers, body, timeoutMs });
        return {
          status: Number(res.status) || 0,
          headers: res.headers || {},
          bytes: CM.util.base64ToBytes(res.bodyBase64 || '')
        };
      },

      async fsRead({ path }) {
        if (!ChipNative) return { exists: false, data: '', mtime: 0 };
        return ChipNative.fsRead({ path });
      },

      async fsWrite({ path, data }) {
        if (!ChipNative) return;
        await ChipNative.fsWrite({ path, data });
      },

      async fsList({ path }) {
        if (!ChipNative) return { files: [] };
        return ChipNative.fsList({ path });
      },

      async fsRemove({ path }) {
        if (!ChipNative) return;
        await ChipNative.fsRemove({ path });
      },

      async vaultGet({ key }) {
        if (!ChipNative) return { value: '' };
        return ChipNative.vaultGet({ key });
      },

      async vaultSet({ key, value }) {
        if (!ChipNative) return;
        await ChipNative.vaultSet({ key, value });
      },

      async vaultRemove({ key }) {
        if (!ChipNative) return;
        await ChipNative.vaultRemove({ key });
      },

      async notifyPermission({ request = false } = {}) {
        if (!LocalNotifications) return { display: 'unsupported' };
        try {
          const cur = await LocalNotifications.checkPermissions();
          if (cur && cur.display === 'granted') return { display: 'granted' };
          if (request) {
            const next = await LocalNotifications.requestPermissions();
            return { display: (next && next.display) || 'denied' };
          }
          return { display: (cur && cur.display) || 'prompt' };
        } catch {
          return { display: 'unsupported' };
        }
      },

      async notifySchedule({ id, hour, minute, title, body }) {
        if (!LocalNotifications) return;
        await notifyChannelReady;
        await LocalNotifications.schedule({
          notifications: [
            {
              id: Number(id) || 1001,
              title: String(title || '籌碼雷達 每日晨報'),
              body: String(body || '點擊查看今日台美股盤勢與重點新聞'),
              channelId: 'daily-briefing',
              schedule: {
                on: { hour: Number(hour), minute: Number(minute) },
                allowWhileIdle: true
              },
              extra: { page: 'briefing' }
            }
          ]
        });
      },

      async notifyCancel({ ids }) {
        if (!LocalNotifications || !Array.isArray(ids) || !ids.length) return;
        try {
          await LocalNotifications.cancel({ notifications: ids.map(id => ({ id: Number(id) })) });
        } catch {
          // 忽略取消不存在排程時的錯誤
        }
      },

      async notifyPending() {
        if (!LocalNotifications) return { ids: [] };
        try {
          const res = await LocalNotifications.getPending();
          return { ids: ((res && res.notifications) || []).map(n => n.id) };
        } catch {
          return { ids: [] };
        }
      },

      async openExternal({ url }) {
        if (ChipNative && typeof ChipNative.openExternal === 'function') {
          await ChipNative.openExternal({ url });
        } else if (typeof window !== 'undefined') {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      }
    };
  }

  CM.installCapacitorBridge = function installCapacitorBridge() {
    CM.native = createCapacitorNative();
    return CM.native;
  };
})(globalThis.ChipMobile = globalThis.ChipMobile || {});
