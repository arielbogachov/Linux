import csv
import os
import subprocess  

original_file_path = '/var/tmp/<>.txt'
new_file_path = '/var/tmp/<>.txt' 

def create_new_file(file_path):
    """Create an empty new file."""
    with open(file_path, 'w') as file:
        pass

def read_csv(file_path):
    if not os.path.exists(file_path):
        return []
    
    with open(file_path, 'r') as file:
        reader = csv.reader(file)
        return list(reader)

def write_csv(file_path, data):
    with open(file_path, 'w', newline='') as file:
        writer = csv.writer(file)
        writer.writerows(data)

def find_new_entries(original_data, new_data):
    return [row for row in new_data if row not in original_data]

def find_removed_entries(original_data, new_data):
    return [row for row in original_data if row not in new_data]

# Create a new file for you to paste the new data into
create_new_file(new_file_path)
print(f"New file created: {new_file_path}")

# Open the new file
subprocess.call(['xdg-open', new_file_path])  

input("Please paste the new data into the file and save it. Press Enter to continue...")

# Read data from the original file and the new file
original_data = read_csv(original_file_path)
new_data = read_csv(new_file_path)

# Find new and removed entries
new_entries = find_new_entries(original_data, new_data)
removed_entries = find_removed_entries(original_data, new_data)

# Display the differences
if new_entries:
    print("New entries found:")
    for entry in new_entries:
        print(entry)
else:
    print("No new entries found.")

if removed_entries:
    print("Removed entries found:")
    for entry in removed_entries:
        print(entry)
else:
    print("No removed entries found.")

# Update the original file if there are any changes
if new_entries or removed_entries:
    print("Updating the original file...")
    write_csv(original_file_path, new_data)
else:
    print("No updates needed.")

os.remove(new_file_path)
print("The new file has been removed.")
