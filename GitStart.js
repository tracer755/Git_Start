import axios from "axios";
import { Octokit, App } from "octokit";
import extra_fs from "fs-extra";
const { readFile } = extra_fs;
import path from "path";
import fs from "fs";
import AdmZip from "adm-zip";
import { pipeline } from "stream";
import { promisify } from "util";
import { spawn } from "child_process";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { start } from "repl";

import config from './config/config.json' assert { type: 'json' };
const GithubToken = config.GithubToken;
const GithubUsername = config.GithubUsername;
const RepositoryName = config.RepoName;

const streamPipeline = promisify(pipeline);

console.log("Starting Git Start...");

const octokit = new Octokit({ auth: GithubToken });

const login = await octokit.rest.users.getAuthenticated({login: GithubToken});
console.log("Logged into Github as " + login.data.name);

let child = "";
let isChildRunning = false;
let hasChildRun = false;

function startChild(){
  console.log("Starting Child");
  child = spawn('node', [__dirname + "/app/" + config.StartLocation]);
  isChildRunning = true;
  child.stdout.on('data', (data) => {
    console.log(`[App]  ${data}`);
  });

  child.stderr.on('data', (data) => {
    console.error(`[App]  ${data}`);
  });

  child.on('close', (code) => {
    console.log(`Stopping child process`);
    isChildRunning = false;
  });
}

async function checkForUpdate(){
  const id = await octokit.rest.repos.listCommits({
    owner: GithubUsername,
    repo: RepositoryName
  });
  let githubSHA = id.data[0].sha;

  const { data } = await octokit.rest.repos.getContent({
    owner: GithubUsername,
    repo: RepositoryName,
    path: '',
    ref: 'main',
  });

  extra_fs.readFile('./config/Current_ID.txt', 'utf-8', (err, data) => {
    if(err){
      console.log(err);
      console.log("Failed to read current ID from file");
      return;
    }
    if(githubSHA != data){
      console.log("App needs update");
      updateApp();
    }
    else if(!hasChildRun){
      startChild();
    }
  })
}

async function updateApp(){
  //stop app
  if(child != "" || isChildRunning){
    await child.kill();
  }
  //transfer to temp dir

  if(await extra_fs.existsSync("./OLD_app")){
    await extra_fs.removeSync("./OLD_app");
  }

  await extra_fs.renameSync("./app", "./OLD_app");
  //download
  const response = await octokit.request('GET /repos/{owner}/{repo}/zipball/{ref}', {
    request: {
      parseSuccessResponseBody: false
    },
    owner: GithubUsername,
    repo: RepositoryName,
    ref: 'main'
  });

  const downloadResponse = await fetch(response.url);
  await streamPipeline(downloadResponse.body, fs.createWriteStream(`./app.zip`));
  const zip = AdmZip("./app.zip");
  zip.extractAllTo("app_extract");
  const subfolder = fs.readdirSync("./app_extract")[0];
  
  await extra_fs.renameSync("./app_extract/" + subfolder, "./app");

  if(await extra_fs.existsSync("./app.zip")){
    await extra_fs.removeSync("./app.zip");
  }
  if(await extra_fs.existsSync("./app_extract")){
    await extra_fs.removeSync("./app_extract");
  }

  //transfer folders
  
  //start app

  const id = await octokit.rest.repos.listCommits({
    owner: GithubUsername,
    repo: RepositoryName
  });
  let githubSHA = id.data[0].sha;

  await fs.writeFileSync("./config/Current_ID.txt", githubSHA, {encoding:'utf8',flag:'w'});

  console.log("Finished update to commit: " + githubSHA);

  startChild();
}

checkForUpdate();

setInterval(function() {
  checkForUpdate();
}, 60 * 1000);

process.on('exit', (code) => {
  child.kill();
  console.log(`Process is exiting with code: ${code}`);
});