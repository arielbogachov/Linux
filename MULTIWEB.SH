#!/bin/bash

# Variables

URL='https://www.tooplate.com/zip-templates/2129_crispy_kitchen.zip'
TemplateNAME='2129_crispy_kitchen'
DIR="/tmp/webfiles"

yum --help &> /dev/null

if [ $? -eq 0 ]
then
   # Set Variables for CentOS
   PACKAGE="httpd wget unzip"
   SERVICE="httpd"

 # Installing tool for web

   echo "Running Setup on CentOS"
   echo "########################################"
   echo "Installing packages."
   echo "########################################"
   sudo yum install $PACKAGE -y > /dev/null
   echo

   # Start & Enable Service
   echo "########################################"
   echo "Start AND Enable HTTPD Service"
   echo "########################################"
   sudo systemctl start $SERVICE
   sudo systemctl enable $SERVICE
   echo

   # Creating Temp Directory
   echo "########################################"
   echo "Start Deployment"
   echo "########################################"
   mkdir -p $DIR
   cd $DIR
   echo

   wget $URL > /dev/null
   unzip $TemplateNAME.zip > /dev/null
   sudo cp -r $TemplateNAME/* /var/www/html/
   echo

   # Bounce Service
   echo "########################################"
   echo "Restarting HTTPD service"
   echo "########################################"
   systemctl restart $SERVICE
   echo

   # Clean Up
   echo "########################################"
   echo "Removing Temp Files"
   echo "########################################"
   rm -rf $DIR
   echo

   sudo systemctl status $SERVICE
   ls /var/www/html/

else
    # Set Variables for Ubuntu
   PACKAGE="apache2 wget unzip"
   SERVICE="apache2"

   echo "Running Setup on CentOS"
   # Installing Dependencies
   echo "########################################"
   echo "Installing packages."
   echo "########################################"
   sudo apt update
   sudo apt install $PACKAGE -y > /dev/null
   echo

   # Start & Enable Service
   echo "########################################"
   echo "Start & Enable HTTPD Service"
   echo "########################################"
   sudo systemctl start $SERVICE
   sudo systemctl enable $SERVICE
   echo

   # Creating Temp Directory
   echo "########################################"
   echo "Start Deployment"
   echo "########################################"
   mkdir -p $DIR
   cd $DIR
   echo

   wget $URL > /dev/null
   unzip $TemplateNAME.zip > /dev/null
   sudo cp -r $TemplateNAME/* /var/www/html/
   echo

   # Bounce Service
   echo "########################################"
   echo "Restarting HTTPD service"
   echo "########################################"
   systemctl restart $SERVICE
   echo

   # Clean Up
   echo "########################################"
   echo "Removing Temp Files"
   echo "########################################"
   rm -rf $DIR
   echo

   sudo systemctl status $SERVICE
   ls /var/www/html/
fi 
