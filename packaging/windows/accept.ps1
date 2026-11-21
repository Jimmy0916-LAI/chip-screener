param([Parameter(Mandatory)][string]$Zip, [Parameter(Mandatory)][string]$ExpectedHash)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Join-Path $env:RUNNER_TEMP ('b03-' + [guid]::NewGuid().ToString('N'))
$extract = Join-Path $root 'v0.6.0-b03.2'
$move = Join-Path $root '台股 移動 測試'
$out = (New-Item -Type Directory -Path 'evidence' -Force).FullName
$zipPath = (Resolve-Path $Zip).Path
$hash = (Get-FileHash $zipPath).Hash.ToLowerInvariant()
if ($hash -ne $ExpectedHash.ToLowerInvariant()) { throw 'Actions artifact ZIP digest mismatch' }
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    if ($archive.Entries.Count -ne 1 -or $archive.Entries[0].FullName -cne 'ChipScreener.exe') { throw 'ZIP must contain only ChipScreener.exe at root' }
} finally { $archive.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory($zipPath,$extract)
$exe = Join-Path $extract 'ChipScreener.exe'
$exeHash = (Get-FileHash $exe).Hash.ToLowerInvariant()
$dest = (New-Item -Type Directory -Path $move).FullName
$relocated = Join-Path $dest 'ChipScreener.exe'
$env:LOCALAPPDATA = (New-Item -Type Directory -Path (Join-Path $root 'fresh-local')).FullName
$env:TEMP = (New-Item -Type Directory -Path (Join-Path $root 'runtime-temp')).FullName
$env:TMP = $env:TEMP
$runtime = Join-Path $env:TEMP 'ChipScreener-B03-v2\ChipScreener.exe'
$group = 'B03-' + [guid]::NewGuid().ToString('N')
$upgradeDir = (New-Item -Type Directory -Path (Join-Path $root '同位置 換版')).FullName
$upgrade = Join-Path $upgradeDir 'ChipScreener.exe'
$oldRuntime = Join-Path $env:TEMP 'ChipScreener-B03-v1\ChipScreener.exe'
$olderDir = (New-Item -Type Directory -Path (Join-Path $root 'v0.6.0-b03.1')).FullName
$older = Join-Path $olderDir 'ChipScreener.exe'
function Test-Stored([string]$file,[string]$phase) {
    node "$PSScriptRoot/gui.cjs" $file $out $phase
    if ($LASTEXITCODE) { throw "B03 GUI failure: $phase" }
}
function Get-VisibleWindow {
    Get-Process -Name ChipScreener -ErrorAction SilentlyContinue | Where-Object {
        $_.MainWindowHandle -ne 0 -and $_.Path -eq $runtime -and $_.MainWindowTitle -like '*籌碼雷達*'
    } | Select-Object -First 1
}
function Test-ShellLaunch([string]$file) {
    # ShellExecute uses the user's normal EXE open verb, with zero arguments.
    $si = [Diagnostics.ProcessStartInfo]::new()
    $si.FileName = $file
    $si.WorkingDirectory = Split-Path $file
    $si.UseShellExecute = $true
    $proc = [Diagnostics.Process]::Start($si)
    try {
        $until = [datetime]::UtcNow.AddSeconds(85)
        do {
            Start-Sleep -Milliseconds 350
            $window = Get-VisibleWindow
        } until ($window -or $proc.HasExited -or [datetime]::UtcNow -gt $until)
        if (!$window) { throw "No visible dashboard from shell launch: $file" }
        $title = $window.MainWindowTitle
        $reader = [IO.BinaryReader]::new([IO.File]::OpenRead($window.Path))
        try {
            $reader.BaseStream.Position = 60
            $reader.BaseStream.Position = $reader.ReadInt32()
            if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664) { throw 'Application runtime is not PE x64' }
        } finally { $reader.Dispose() }
        if (!$window.CloseMainWindow() -or !$proc.WaitForExit(30000) -or $proc.ExitCode -ne 0) { throw 'Shell launch did not close cleanly' }
        return $title
    } finally { if (!$proc.HasExited) { $proc.Kill($true) }; $proc.Dispose() }
}
try {
    if (@(Get-NetFirewallProfile -PolicyStore ActiveStore | Where-Object Enabled -ne 'True').Count) { throw 'Runner firewall is not fully enabled' }
    foreach ($program in @($exe,$relocated,$runtime,$upgrade,$oldRuntime,$older)) {
        New-NetFirewallRule -DisplayName "$group $program" -Group $group -Direction Outbound -Action Block -Profile Any -Program $program -RemoteAddress '0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255','::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff' | Out-Null
    }
    if (@(Get-NetFirewallRule -Group $group -PolicyStore ActiveStore | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Block' }).Count -ne 6) { throw 'Outbound isolation not active' }
    if (@(Get-ChildItem $env:LOCALAPPDATA -Force).Count) { throw 'Expected clean app data' }
    $first = Test-ShellLaunch $exe
    $qa = Join-Path $PSScriptRoot 'gui.cjs'
    node $qa $exe $out 'first'
    if ($LASTEXITCODE) { throw 'Offline GUI verification failed' }
    Test-Stored $exe 'seed'
    Test-Stored $exe 'reopen'
    if (@(Get-ChildItem $dest -Force).Count) { throw 'Destination is not empty' }
    Move-Item -LiteralPath $exe -Destination $relocated
    if ((Get-FileHash $relocated).Hash.ToLowerInvariant() -ne $exeHash) { throw 'Moved EXE hash changed' }
    $second = Test-ShellLaunch $relocated
    node $qa $relocated $out 'moved'
    if ($LASTEXITCODE) { throw 'Relocated GUI verification failed' }
    if (@(Get-ChildItem $dest -Force).Count -ne 1) { throw 'Extra files beside portable EXE' }
    Test-Stored $relocated 'moved-stored'
    Test-Stored $relocated 'write-failure'
    Test-Stored $relocated 'after-failure'
    $userStore = Join-Path $env:LOCALAPPDATA 'ChipScreener/store-v1'
    foreach ($kind in @('snapshot','settings')) {
        $primary = Join-Path $userStore "$kind.current.json"
        if (!(Test-Path $primary -PathType Leaf)) { throw "Missing committed $kind" }
        [IO.File]::WriteAllText($primary,'truncated')
    }
    Test-Stored $relocated 'recovered'
    # Independent upgrade path. Seed an actual older build, overwrite only the EXE,
    # then reopen the exact deliverable on the same account and storage location.
    $env:LOCALAPPDATA = (New-Item -Type Directory -Path (Join-Path $root 'upgrade-local')).FullName
    Copy-Item -LiteralPath 'qa-predecessor/ChipScreener.exe' -Destination $upgrade
    $oldHash = (Get-FileHash $upgrade).Hash.ToLowerInvariant()
    if ($oldHash -eq $exeHash) { throw 'Expected two distinct application builds' }
    Test-Stored $upgrade 'upgrade-source'
    Copy-Item -LiteralPath $relocated -Destination $upgrade -Force
    if ((Get-FileHash $upgrade).Hash.ToLowerInvariant() -ne $exeHash) { throw 'Replacement is not the ZIP executable' }
    Test-Stored $upgrade 'upgrade-result'
    if (@(Get-ChildItem $upgradeDir -Force).Count -ne 1) { throw 'Extra file in replacement directory' }
    # Make both distinct versions available side by side without touching the older folder.
    Copy-Item 'qa-predecessor/ChipScreener.exe' $older
    Copy-Item $relocated $exe
    $env:LOCALAPPDATA = (New-Item -Type Directory -Path (Join-Path $root 'revision-local')).FullName
    Test-Stored $older 'revision-seed'
    $store = Join-Path $env:LOCALAPPDATA 'ChipScreener/store-v1'
    foreach ($kind in @('snapshot','settings')) {
        $current = Join-Path $store "$kind.current.json"
        Copy-Item $current "$current.tmp"
        [IO.File]::WriteAllText($current,'truncated')
    }
    Test-Stored $exe 'revision-recover'
    Test-Stored $exe 'revision-reopen'
    if ((Get-FileHash $older).Hash.ToLowerInvariant() -ne $oldHash -or (Get-FileHash $exe).Hash.ToLowerInvariant() -ne $exeHash) { throw 'Version folder contents changed' }
    $report = [ordered]@{commit=$env:B03_HEAD; zipSha256=$hash; exeSha256=$exeHash; entries=@('ChipScreener.exe');
        os=(Get-CimInstance Win32_OperatingSystem).Caption; priorVersionExeSha256=$oldHash; runtimePE='x64'; zeroArgumentWindows=@($first,$second);
        offline='Windows Firewall blocked non-loopback outbound connections for both launchers and the verified GUI executable';
        movedTo=$relocated; windows11Physical='not tested'}
    $report | ConvertTo-Json | Tee-Object -FilePath "$out/package.json"
    "ZIP SHA-256: $hash" >> $env:GITHUB_STEP_SUMMARY
    "EXE SHA-256: $exeHash" >> $env:GITHUB_STEP_SUMMARY
} finally { Get-NetFirewallRule -Group $group -ErrorAction SilentlyContinue | Remove-NetFirewallRule }
