#!/bin/bash

read -p 'Enter Command to execute on remote machines: ' Command
echo "Executing $Command on all the WEBNODE's"

##checking in text file that we store our servers

for IP in $(cat webIP.txt); 
do 
  echo "######################################"
  echo "Checking Command on $IP"
  echo "######################################"
  ssh root@$IP "$Command; uptime; w"  ##checks the command with uptime
done

