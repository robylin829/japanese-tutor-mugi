param([switch]$RunPaidChecks)
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:3004'
$before = Invoke-RestMethod "$base/api/settings/openai-api"
if (-not $before.configured) { Write-Output 'NOT RUN: Configure the API key in the local settings page first. Do not paste it into chat.'; return }
if ($before.error) { throw $before.error }
if (-not $RunPaidChecks) { Write-Output 'NOT RUN: These four real requests incur API usage. Re-run with -RunPaidChecks; the batch limit is at most USD 0.10.'; return }
$originalBudget = [double]$before.usd
$temporaryBudget = [Math]::Min($originalBudget, [Math]::Floor(([double]$before.spentTodayUsd + 0.10) * 100) / 100)
function Post-Json($path, $data) {
  $json = ConvertTo-Json -InputObject $data -Depth 10 -Compress
  Invoke-WebRequest "$base$path" -UseBasicParsing -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 130
}
$hiragana = -join ([char[]](0x304A,0x306F,0x3088,0x3046))
$greeting = -join ([char[]](0x3053,0x3093,0x306B,0x3061,0x306F))
$jobs = @(
  @{ name='chat'; path='/api/chat'; data=@{ providers=@('openai-api'); messages=@(@{ role='user'; content='Please greet me briefly in Japanese.' }); role='Mugi'; mode='teacher'; context=@{} } },
  @{ name='judge'; path='/api/chat/judge'; data=@{ providers=@('openai-api'); target=$hiragana; said=$greeting } },
  @{ name='tip'; path='/api/chat/fix-tip'; data=@{ providers=@('openai-api'); tip=('Use <ja>' + $greeting + '</ja> as a daytime greeting. Explain this in Traditional Chinese.') } },
  @{ name='lookup'; path='/api/lookup'; data=@{ providers=@('openai-api'); q=$greeting } }
)
try {
  Post-Json '/api/settings/openai-api' @{ usd=$temporaryBudget } | Out-Null
  foreach ($job in $jobs) {
    $current = Invoke-RestMethod "$base/api/settings/openai-api"
    if ([Math]::Abs([double]$current.usd - $temporaryBudget) -gt 0.000001) { throw 'Temporary budget was overridden; no further paid requests will be sent.' }
    if ([Math]::Abs([double]$current.usd - $temporaryBudget) -gt 0.000001) { throw 'Temporary budget was overridden; no further paid requests will be sent.' }
    if ($current.day -ne $before.day) { throw 'Taipei day changed; stop and rerun on the new day.' }
    $response = Post-Json $job.path $job.data
    if ($job.name -eq 'chat') {
      $events = [regex]::Matches($response.Content, '(?m)^data: (.+)$') | ForEach-Object { $_.Groups[1].Value | ConvertFrom-Json }
      $done = $events | Where-Object type -EQ 'done'
      if (-not $done -or ($events | Where-Object type -EQ 'error')) { throw 'Chat stream did not complete.' }
      $reply = $done.text | ConvertFrom-Json
      if (-not $reply.segments -or $done.provider -ne 'openai-api') { throw 'Unexpected chat response.' }
    } else {
      $reply = $response.Content | ConvertFrom-Json
      if ($reply.provider -ne 'openai-api') { throw 'Unexpected response provider.' }
      if ($job.name -eq 'judge') { if ($reply.ok -isnot [bool] -or -not $reply.feedback) { throw 'Unexpected judge response.' } }
      elseif (-not $reply.ok) { throw ('Unusable response for ' + $job.name) }
    }
    Write-Output ('PASS: ' + $job.name)
  }
} finally {
  Post-Json '/api/settings/openai-api' @{ usd=$originalBudget } | Out-Null
  $after = Invoke-RestMethod "$base/api/settings/openai-api"
  Write-Output ('Estimated batch spend (includes any concurrent activity): USD ' + ([double]$after.spentTodayUsd - [double]$before.spentTodayUsd).ToString('F6'))
  Write-Output ('Restored daily API budget: USD ' + $originalBudget)
}
