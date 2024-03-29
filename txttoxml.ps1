# Read the text file and Update with your file path

$filePath = "C:\path\to\input.txt" 
$textData = Get-Content -Path $filePath

# Create an XML string
$xmlString = '<?xml version="1.0" encoding="UTF-8"?>'
$xmlString += "<Data>"

foreach ($line in $textData) {
    $arguments = $line -split "\|"

#The argumets is for example but you can chage as your choise ,also the count of columns 

    if ($arguments.Count -eq 6) {
        $xmlString += "<Person>"
        $xmlString += "<Name>$($arguments[0])</Name>"
        $xmlString += "<Age>$($arguments[1])</Age>"
        $xmlString += "<City>$($arguments[2])</City>"
        $xmlString += "<Gender>$($arguments[3])</Gender>"
        $xmlString += "<Occupation>$($arguments[4])</Occupation>"
        $xmlString += "<Subject>$($arguments[5])</Subject>"
        $xmlString += "</Person>"
    }
}

$xmlString += "</Data>"

# Print the XML string
Write-Host $xmlString

# Save the XML string to a file
$xmlString | Out-File -FilePath "C:\path\to\output.xml" -Encoding UTF8
