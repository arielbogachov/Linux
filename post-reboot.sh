#!/bin/bash

POSTSEC_REBOOT_SCRIPT="/var/tmp/removetemp.sh"
LOG_FILE="/var/tmp/post_reboot.log"
STATE_FILE="/var/tmp/reboot.txt"
NUM_FILE="/var/tmp/hostname_num.txt"
user="<username>"
password="<password>"

sleep 60 

# Redirect all output to the log file
exec > >(tee -a "$LOG_FILE") 2>&1

echo "Starting post-reboot script..."

if [ ! -f "$STATE_FILE" ]; then
    echo "State file not found. Exiting."
    exit 1
fi

if [ ! -f "$NUM_FILE" ]; then
    echo "Hostname number file not found. Exiting."
    exit 1
fi


num=$(cat "$NUM_FILE")
echo "Hostname number is: $num"

# Check if orca-ghost user is logged in and log out
if who | grep -q "$user"; then
    echo "User $user is currently logged in. Logging out user..."
    sudo pkill -u "$user" || { echo "Failed to kill processes owned by $user"; exit 1; }
fi
# Rename orca-ghost
echo "Renaming $orcaghost to $num..."
echo "$password" | sudo usermod -l "$num" "$user" || { echo "Failed to rename user"; exit 1; }
echo "$password" | sudo usermod -d "/home/$num" -m "$num" || { echo "Failed to move home directory"; exit 1; }
echo "$password" | sudo ln -s  "/home/$num" "/home/$user" || { echo "Failed to create symlink"; exit 1; }

# Update the python environment or other configurations as needed
echo "Updating python environment..."
echo "$password" | sudo -S sed -i "s/$user/$num/g" "/home/$num/.pyenv/versions/3.7.4/bin/pip" || { echo "Failed to update python version"; exit 1; }


# Additional configuration
echo "Updating GDM3 configuration..."
echo "$password" | sudo -S bash -c "echo -e '[daemon]\nAutomaticLoginEnable=true\nAutomaticLogin=$num' > /etc/gdm3/custom.conf"

#removes the post script from crontab
(crontab -l -u temp 2>/dev/null | grep -v "@reboot $POST_REBOOT_SCRIPT") | sudo crontab -u temp -
echo "Updated crontab for user temp:"
sudo crontab -l -u temp

#make the another reboot script
(crontab -l -u $num 2>/dev/null; echo "@reboot $POSTSEC_REBOOT_SCRIPT") | sudo crontab -u $num - || { echo "Failed to add post-reboot script to crontab"; exit 1; }


echo "Post-reboot tasks completed successfully."

sudo reboot
