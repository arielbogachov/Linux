import json
import os
import re
import sys
import subprocess
import datetime

# Get vessels info and extract the calibration number
def get_vessels_info(vessel):
    
    file_path = f"/path/to/folder/<>.json"

    try:
        with open(file_path, 'r') as file:
            data = json.load(file)
        
        if 'ingredients' in data and isinstance(data['ingredients'], list):
            # Loop through each ingredient path
            for ingredient in data['ingredients']:
                path_value = ingredient.get('path', '')
                
                # Filter for 'X' paths
                if "X" in path_value:
                    match = re.search(r'(\d+)', path_value)
                    if match:
                        number = match.group(1)
                        print(f"Calibration number: {number}")
                        return number
                        #return vessel, number
        print("No calibration number found.")
        return vessel, None
    
    except FileNotFoundError:
        print(f"Error: File '{file_path}' not found.")
        return None, None
    except json.JSONDecodeError:
        print("Error: Failed to decode JSON.")
        return None, None
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        return None, None

def check_s3_frames(vessel):
    try:
        current_date = datetime.date.today()
        vessels_formatted = vessel.replace("-", "_").upper()
        
        # S3 base path without specifying the month
        s3_base_path = f"s3:/path/{vessels_formatted}/{current_date.year}/"
  
        print(f"Processing can continue for {vessel}.")
        result = subprocess.check_output(["aws", "s3", "ls", s3_base_path]).decode().splitlines()
        months = [line.split()[-1].strip('/') for line in result] 
      
        
        if len(months) <= 2:  
            print("Less than 2 months found. Checking frames by day.")
            check_days = 10  
        else:
            print("More than 2 months found. Checking day folders.")
            total_day_folders = 0
            
            # Loop through the last 2 months
            for month in months[-2:]:  
                month_path = f"{s3_base_path}{month}/"
                day_result = subprocess.check_output(["aws", "s3", "ls", month_path]).decode().splitlines()
                day_folders = [line.split()[-1].strip('/') for line in day_result]
                total_day_folders += len(day_folders)
                print(f"Month {month}: {len(day_folders)} day folders found.")  

            # If 10 or more day-folders are found- would work
            if total_day_folders >= 10:
                print(f"Total day-folders across last 2 months: {total_day_folders}. Proceeding with the next steps.")
                return True  
            else:
                print(f"Total day-folders across last 2 months: {total_day_folders}. Not enough to proceed.")
                return False

        # If fewer than 3 months, proceed with detailed frame count check 
        frame_count = 0
        days_ago = current_date - datetime.timedelta(days=check_days)
        for month in months:
            month_path = f"{s3_base_path}{month}/"
            day_result = subprocess.check_output(["aws", "s3", "ls", month_path]).decode().splitlines()
            day_folders = [line.split()[-1] for line in day_result]
            
            # Check each day folder
            for day_folder in day_folders:
                day_path = f"{month_path}{day_folder}"
                day_content = subprocess.check_output(["aws", "s3", "ls", day_path]).decode().splitlines()
                
                # Count frames within the date range
                for item in day_content:
                    file_date_str = item.split()[0]
                    file_date = datetime.datetime.strptime(file_date_str, '%Y-%m-%d').date()
                    if days_ago <= file_date <= current_date:
                        frame_count += 1

        
        if frame_count == 0:
            print(f"No frames found in the S3 bucket for vessels {vessels_formatted} in the last {check_days} days.")
            return False
        elif frame_count <= 70:
            print(f"Total frame count is {frame_count} over the last {check_days} days. This is not enough to proceed.")
            return False
        else:
            print(f"Frames found: {frame_count} in the last {check_days} days. Proceeding with the next steps.")
            return True

    except subprocess.CalledProcessError as e:
        print(f"Error checking S3: {e}")
        return False
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        return False
    
def calibration(vessels, number):
    if vessels is None or number is None:
        print("Exiting, no vessels or calibration number found.")
        return
    
    vessels = vessels.replace("-", "_").upper()

    current_date = datetime.date.today()
    ten_days_ago = current_date - datetime.timedelta(days=10)

    formatted_current_date = current_date.strftime("%d_%m_%Y")
    formatted_ten_days_ago = ten_days_ago.strftime("%d_%m_%Y")

    formatted_output = f"{vessels}, {formatted_ten_days_ago}, {formatted_current_date}\n"

    filename = "/home/orca-ghost/data/csvs/to_download.csv" 

    with open(filename, "w") as file:
        file.write(formatted_output)

    print(f"File {filename} has been updated.")

    # Running the download command
    command1 = [
        "python3", 
        "path/to/code//download_data.py", 
        "--root_dir", os.path.expanduser("~/"), 
        "--csv_path", os.path.expanduser("/.csv")
    ]

    result = subprocess.run(command1, check=True)
    print("************************************************************************************************")
    print("The frames download successfully finshed.")
    print("************************************************************************************************")

    frames_dir = f"/path/to/folder/{vessels}-{formatted_ten_days_ago}-{formatted_current_date}"

    # Running the camera rotation estimator command
    command2 = [
        "python3", 
        "path/to/code/X.py", 
        "--lou_version", "o3", 
        "--masks_dir", os.path.expanduser("/.../../"),
        "--calibio_dir", os.path.expanduser("/../../"),
        "--frames_dir", frames_dir,
        "--pod_number", str(number)

    ]
    result = subprocess.run(command2, check=True)
    print("************************************************************************************************")
    print("The calibration successfully finshed. (say thanks to Ariel!)")
    print("************************************************************************************************")


def main():

    #print(sys.argv)
    
    vessels = sys.argv[1:]
    for vessel in vessels:
        # get_vessels_info(vessel)
        number = get_vessels_info(vessel)
        if not vessel or not number:
            print("No vessels information available. Exiting.")
            return
        
        success = check_s3_frames(vessel)
        if success:
            calibration(vessel, number)
        else:
            print(f"Processing cannot continue for {vessel}.")
            print("************************************************************************************************")
                
    
if __name__ == "__main__":
    main()

