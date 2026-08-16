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
