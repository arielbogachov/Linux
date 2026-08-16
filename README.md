<<<<<<< HEAD
Install the APP: 
npm install && npm start

if you dont have node.js - install

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - sudo apt-get install -y nodejs

Connec to CLI - open new terminal and run:
npm link

CLI commands:
kontrolix --help
kontrolix create examples/build-deploy.json
kontrolix list
kontrolix logs <runId> --follow
kontrolix runs
kontrolix runs build-and-deploy-web   # filtered to one job
# Preview only — prints the changes + optimized file to your terminal
kontrolix optimize k8s/web-deployment.yaml --type k8s

# Preview and save the result locally instead of printing it
kontrolix optimize docker-compose.yml --type compose --out docker-compose.optimized.yml

# Actually apply — writes the optimized file into ./optimized-output on the server
kontrolix optimize Dockerfile --type dockerfile --apply
kontrolix delete build-and-deploy-web
=======
Install the APP:
unzip dokube-ci.zip && cd dokerbuild
npm install
npm start


if you dont have node.js - install

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

CLI commands:

npm link
dokube create examples/build-deploy.json
dokube list
dokube run build-and-deploy-web
dokube logs <runId> --follow
dokube runs
>>>>>>> 0f810858a8188588e98ea8ac7d15dfaa2f0b8d4e
