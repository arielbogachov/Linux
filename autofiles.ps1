#scripyt for automation folder/files

$logdate= get-date -Format "yy.MM__hh.mm"
$logdir= "<Drive>\<folder1>\file_$logdate.log"
New-Item -Path $logdir -ItemType File
$local=Get-ChildItem "<server\Drive>\<folder1>\.."
$cleaner=Get-ChildItem "\\<Far-server>\<Drive>\<folder1>\.."
$dest="\\<Far-server>\<Drive>\<folder1>\.."
$earldate-(get-date).AddDays(-7)
$lastdate=(get-date)
 
 #check for any older folder and clean 

 Write-Host "################################"
 Write-Host "Check for older folders\files"
 Write-Host "################################"

 Foreach ($fyl in $cleaner){
 if(($earldate -gt $fyl.CreationTime)){
 Remove-Item "$dest\$fyl" -Recurse -Force -Confirm:$false
"$($fyl) : $($fyl.CreationTime) : $("Deleted") " | Out-File $logdir -Append
}}
 
 #check for new updates in folder/files
  
 Write-Host "################################"
 Write-Host "Check for new folders\files"
 Write-Host "################################"

 forEach($row in $local){
 if(($row.CreationTime -ge $earldate) -and ($row.CreatiomTime -lt $lastdate )){
 Robocopy "<server\Drive>\<folder1>\..\$row" "$dest\$row" /MIR
 "$($row) : $($row.CreationTime) : $("Copied") " | Out-File $logdir -Append
 }}

 #a pop up that alert on the log file to see

$OKBUTTON = "look at the log file"
$thepopup =New-Object -ComObject Wscript.Shell
$thepopup.Popup("$OKAYBUTTON",0,"Warning",0x0)

 exit;






