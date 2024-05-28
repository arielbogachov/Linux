#!/bin/bash

STATE_FILE="/var/tmp/reboot.txt"
NUM_FILE="/var/tmp/hostname_num.txt"
POST_REBOOT_SCRIPT="/var/tmp/post-reboot.sh"
LOG_FILE="/var/tmp/pre_reboot.log"


echo "#######################################################"
echo ""
read -p "Put the PU number: " num

# Save hostname number to a file to be used after reboot
sudo hostname "$num"
echo "$num" | sudo tee /etc/hostname > /dev/null
sudo sed -i "s/\(^127.0.1.1\s\).*$/\1$num/" /etc/hosts
echo "$num" | sudo tee "$NUM_FILE" > /dev/null

# Redirect all output to a log file with sudo privileges
exec > >(sudo tee -a "$LOG_FILE") 2>&1

echo "Starting pre-reboot script..."

# Perform pre-reboot tasks here
# For example, setting up environment variables, stopping services, etc.

# Save the state to indicate that the pre-reboot script has run
sudo touch "$STATE_FILE" || { echo "Failed to create state file"; exit 1; }

# Save the hostname number to a file
echo "$num" | sudo tee "$NUM_FILE" >/dev/null || { echo "Failed to create hostname number file"; exit 1; }

user="temp"
pass="Orca123"
orcaghost="orca-ghost"

# Check if user already exists
if id "$user" &>/dev/null; then
    echo "User $user already exists. Skipping user creation."
else
    # Add a new user and set password using useradd
    echo "Adding temporary user..."
    sudo useradd -m -d "/home/$user" -s "/bin/bash" -c "temp" "$user" || { echo "Failed to add user with useradd"; exit 1; }
    echo "$user:$pass" | sudo chpasswd || { echo "Failed to set password"; exit 1; }
    sudo usermod -aG sudo "$user" || { echo "Failed to add user to sudo group"; exit 1; }
fi

# Update GDM3 configuration for automatic login
sudo bash -c 'echo -e "[daemon]\nAutomaticLoginEnable=true\nAutomaticLogin=temp" > /etc/gdm3/custom.conf'
#insert the sudoers file for temp
echo "temp ALL=(ALL) NOPASSWD: /usr/sbin/usermod, /bin/ln, /usr/sbin/deluser, /bin/rm, /bin/sed" | sudo tee /etc/sudoers.d/temp_nopasswd

# Schedule the post-reboot script to run after the reboot for the temp user
echo "Adding post-reboot script to crontab for user temp"
(crontab -l -u temp 2>/dev/null; echo "@reboot $POST_REBOOT_SCRIPT") | sudo crontab -u temp - || { echo "Failed to add post-reboot script to crontab"; exit 1; }

echo "Pre-reboot tasks completed successfully."


# Reboot the system
sudo reboot

