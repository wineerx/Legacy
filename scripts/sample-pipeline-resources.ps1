param([int]$AuditParent, [string]$AuditOutput, [string]$AuditStop)
$auditSamples = [Collections.Generic.List[object]]::new()
while (-not (Test-Path -LiteralPath $AuditStop)) {
  $auditProcesses = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $AuditParent" | Where-Object Name -eq 'ffmpeg.exe')
  $auditSamples.Add([pscustomobject]@{
    timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    processes = @($auditProcesses | ForEach-Object { [pscustomobject]@{ id=$_.ProcessId; cpuMs=([double]$_.UserModeTime+[double]$_.KernelModeTime)/10000; rssBytes=[double]$_.WorkingSetSize; readBytes=[double]$_.ReadTransferCount; writeBytes=[double]$_.WriteTransferCount } })
  })
  Start-Sleep -Milliseconds 100
}
[IO.File]::WriteAllText($AuditOutput, (ConvertTo-Json -InputObject @($auditSamples) -Depth 5), [Text.UTF8Encoding]::new($false))
