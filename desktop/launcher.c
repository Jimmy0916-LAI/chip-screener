#define WIN32_LEAN_AND_MEAN
#include <windows.h>

// Keep the executable and data roots relative to the user's extracted folder.
static WCHAR root[32768], python[32768], command[32768];
int WINAPI wWinMain(HINSTANCE current, HINSTANCE previous, PWSTR args, int show) {
    DWORD len = GetModuleFileNameW(NULL, root, 32768);
    if (!len || len >= 32680) goto failed;
    while (len && root[len-1] != L'\\') len--;
    root[len] = 0;
    lstrcatW(root, L"resources");
    lstrcpyW(python, root);
    lstrcatW(python, L"\\runtime-python\\pythonw.exe");
    lstrcpyW(command, L"pythonw.exe -B -X utf8 scripts\\launcher.py --portable --no-runtime");
    STARTUPINFOW si = {0};
    PROCESS_INFORMATION pi;
    si.cb = sizeof(si);
    if (CreateProcessW(python, command, NULL, NULL, FALSE, CREATE_NO_WINDOW,
                       NULL, root, &si, &pi)) {
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        ExitProcess(0);
    }
failed:
    MessageBoxW(NULL, L"請完整解壓縮 ZIP，確認 resources 資料夾與股票雷達.exe 位於同一層。", L"股票雷達無法啟動", MB_ICONERROR);
    ExitProcess(1);
}
