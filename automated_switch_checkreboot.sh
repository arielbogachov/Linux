#!/bin/bash

# Variables
HOST="192.168.X.X"
USER="user"
PASS="pass"
COMMAND="show interfaces status"
OUTPUT_FILE="switch_interfaces_status.txt"

# Expect script to connect to the switch, execute the command, and save output to a local file
/usr/bin/expect <<EOF1 | tee $OUTPUT_FILE
spawn ssh $USER@$HOST -p <>
expect "User Name:"
send "$USER\r"
expect "Password:"
send "$PASS\r"
expect "#"
send "$COMMAND\r"
expect "#"
send "exit\r"
EOF1

echo "Command output saved to $OUTPUT_FILE"

# Now process the output to display the port, link state, and speed
echo "Port, Link State, and Speed:"
grep "gi[0-9]" $OUTPUT_FILE | while read -r line; do
    port=$(echo $line | awk '{print $1}')
    link_state=$(echo $line | awk '{print $7}')
    speed=$(echo $line | awk '{print $4}')
    echo "Port: $port | Link State: $link_state | Speed: $speed"
done

# Check for ports running at 1000 Mbps and link state is Up
GIGABIT_PORTS=$(grep "gi[0-9]" $OUTPUT_FILE | grep "1000" | grep "Up" | wc -l)

if [ "$GIGABIT_PORTS" -lt 2 ]; then
    echo "Fewer than 2 ports are running at 1000 Mbps and are Up. Rebooting the switch..."

    # Reboot the switch using another expect script
    /usr/bin/expect <<EOF2
    spawn ssh $USER@$HOST -p <>
    expect "User Name:"
    send "$USER\r"
    expect "Password:"
    send "$PASS\r"
    expect "#"
    send "reload\r"

    # Expect the reload confirmation prompt with escaped characters
    expect {
        "You haven't saved your changes. Are you sure you want to continue ? \\(Y/N\\)\\[N\\]" {
            send "Y\r"  # Confirm to reload
        }
        "This command will reset the whole system and disconnect your current session. Do you want to continue ? \\(Y/N\\)\\[N\\]" {
            send "Y\r"  # Confirm to reload for the second variation
        }
    }

    expect "#"
    send "exit\r"
EOF2
    
    echo "The switch is rebooting."
else
    echo "At least 2 ports are running at 1000 Mbps and are Up. No reboot necessary."
fi

