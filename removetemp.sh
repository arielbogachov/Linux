#!/bin/bash

NUM_FILE="/var/tmp/hostname_num.txt"
LOG_FILE="/var/tmp/post_reboot.log"
STATE_FILE="/var/tmp/reboot.txt"
SCRIPT1="/var/tmp/post-reboot.sh"
SCRIPT2="/var/tmp/pre-reboot.sh"
password="Orca123"
REMOVE="/var/tmp/removetemp.sh"

sleep 60

num=$(cat "$NUM_FILE")

echo "$password" | exec > >(sudo tee -a "$LOG_FILE") 2>&1

# Remove the temporary user
echo "Removing temporary user..."
echo "$password" | sudo deluser temp || { echo "Failed to delete temporary user"; exit 1; }
echo "$password" | sudo rm -r /home/temp || { echo "Failed to remove temporary user home directory"; exit 1; }

# Clean up
echo "Cleaning up..."
echo "$password" | sudo rm -rf "$STATE_FILE" "$SCRIPT1" "$SCRIPT2" 

#remove the script from crontab
(crontab -l -u "$num" 2>/dev/null | grep -v "@reboot $REMOVE") | sudo crontab -u "$num" -
echo "the PU bring up done"
