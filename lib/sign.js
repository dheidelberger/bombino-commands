const utils = require("./_utils");
const fs = require("fs");
const path = require("path");
const fse = require("fs-extra");
const inquirer = require("inquirer");
const shell = require("shelljs");
const chalk = require("chalk");
const ora = require("ora");
const boxen = require("boxen");
const klawSync = require("klaw-sync");
const JavaScriptObfuscator = require("javascript-obfuscator");

//
// Function will stage/duplicate current panel into a new temp directory,
// excluding unwanted folders (node_modules, etc.), then package as ZXP
//

// Arguments are as follows
// [
//   '/usr/local/bin/node',
//   '/usr/local/bin/bombino-cmd-david-test',
//   'sign',
//   'private'
// ]

module.exports = async function (args) {
  // This should check the current directory and scan for ZXPSignCmd to determine
  // correct location to launch native terminal command
  //
  // There has to be a better way to do this
  // console.log("Arguments are as follows");
  // console.log(args);

  console.log(`${utils.helpPrompt}`);
  console.log(``);
  // gathering data
  const extVersion = utils.getExtVersion();
  const extName = utils.getExtName();
  let extDist = ``;

  if (args[3]) {
    extDist = `-${args[3]}`;
  }

  const extString = `${extName}_${extVersion}${extDist}`;

  shell.config.silent = true;
  let pwd = shell.pwd();
  const rootDir = pwd.match(/[^\\|\/]*$/)[0];
  shell.config.silent = false;

  // beginning the prompts

  console.log(`${utils.cepBlock}  Signing ${chalk.blue(extString)}!`);
  console.log("");
  console.log(
    `   Be sure to run ${chalk.yellow(
      "npm run register"
    )} prior to this command.`
  );
  console.log(
    `   You can add any valid regex or phrases to ${chalk.green(
      "./.certignore"
    )} to exclude them from staging.`
  );
  console.log("");
  let answer = await promptUser();

  //
  let spinner = ora({
    text: `Staging temp files...`,
    spinner: utils.ORA_SPINNER,
  }).start();
  try {
    let res = await stageExtensionFolder(extString);

    // spinner.stopAndPersist({
    //   symbol: chalk.green("   ✔ "),
    //   text: `Staging complete.`
    // });
    console.log("");
    spinner.stopAndPersist({
      symbol: "",
      text: utils.doneSpinnerText("Staging complete", "green"),
    });
    console.log("");

    if (args[3]) {
      let distChannel = args[3];
      let manifest = path.join(
        "..",
        `${extString}-tmp`,
        "CSXS",
        "manifest.xml"
      );
      let manifestText = fs.readFileSync(manifest, "utf-8");
      manifestText = manifestText.replace(
        /<DistributionSource>.*<\/DistributionSource>/,
        `<DistributionSource>${distChannel}</DistributionSource>`
      );
      fs.writeFileSync(manifest, manifestText);
    }

    if (fs.existsSync(`./obfuscate.json`)) {
      console.log(chalk.green("Adding obfuscation"));
      let obfuscationOptsRaw = fs.readFileSync("./obfuscate.json", "utf8");
      let obfuscationOpts = JSON.parse(obfuscationOptsRaw);
      let folder = `../${extString}-tmp`;
      let jsFiles = klawSync(folder, {
        nodir: true,
        traverseAll: true,
        filter: (file) => {
          return /\.js$/.test(file.path);
        },
      });

      jsFiles.forEach((jsFile) => {
        let filePath = jsFile.path;
        console.log(chalk.yellow(`   Obfuscating: ${jsFile.path}`));
        let rawCode = fs.readFileSync(filePath, "utf8");
        let obf = JavaScriptObfuscator.obfuscate(
          rawCode,
          obfuscationOpts
        ).getObfuscatedCode();
        fs.writeFileSync(filePath, obf);
      });
      console.log("");
      utils.boxLog("Obfuscation complete", "green");
      console.log("");
    }

    spinner = ora({
      text: `Running ${chalk.yellow("ZXPSignCmd")} for you...`,
      spinner: utils.ORA_SPINNER,
    }).start();

    // HALT

    setTimeout(() => {
      signCommands(res, rootDir, answer.password, answer.createZip).then(() => {
        console.log("");
        spinner.stopAndPersist({
          symbol: "",
          text: utils.doneSpinnerText("Signing complete", "green"),
        });
        fse.removeSync(`./${extString}-tmp`);
        fse.removeSync(`./${rootDir}/archive/temp1.p12`);
        utils.boxLog(`${extString}.zxp is ready`, "blue", true);
        console.log(
          `    You can find it in ${chalk.green(`./archive/${extString}.zxp`)}`
        );
        console.log("");
      });
    }, 1000);
  } catch (error) {
    spinner.fail(error.message);
  }
  return "";
};

async function promptUser() {
  return await inquirer.prompt([
    {
      type: "input",
      name: "password",
      message: "Password for certificate",
      default: "hello-world",
    },
    {
      type: "confirm",
      name: "createZip",
      message: "Create a ZIP aswell?",
      default: true,
    },
    // NOT YET WORKING
    // Jsxbin fails on install for me
    // {
    //   type: "confirm",
    //   name: "asJSX",
    //   message: "Convert all scripts to JSX?",
    //   default: true
    // }
  ]);
}

function getIgnores() {
  if (fs.existsSync(`./.certignore`)) {
    ignores = fs.readFileSync(`./.certignore`, {
      encoding: "utf-8",
    });
    ignores = ignores.trim().split(/(\r\n|\n|\r)/);
    ignores = ignores.filter((item) => {
      return item.length > 2;
    });
    ignores = ignores.map((item) => {
      return item.replace(
        /[-\/\\^$*+?.()|[\]{}]/,
        `\\${item.match(/[-\/\\^$*+?.()|[\]{}]/)}`
      );
    });
  } else {
    ignores = ["node_modules", "archive", "^(\\.git)", "ZXPSignCmd.exe"];
    fs.writeFileSync(`./.certignore`, ignores.join("\r\n"));
  }
  return new RegExp(ignores.join("|"));
}

async function confirmSign() {
  return await inquirer.prompt([
    {
      type: "Confirm",
      message: "Are you ready to proceed?",
      name: "confirmation",
      default: true,
    },
  ]);
}

function stageExtensionFolder(extString) {
  let omittedRegex = getIgnores();
  let tempDir = `../${extString}-tmp`;

  try {
    console.log();
    fse.emptyDirSync(tempDir); //Empties directory if it exists, otherwise creates it
    fse.copySync("./", tempDir, {
      filter: function (file) {
        let exclude = omittedRegex.test(file);
        if (exclude) {
          console.log(chalk.yellow(`   Excluding: ${file}`));
          return false;
        }
        return true;
      },
    });

    if (!fs.existsSync(`./archive`)) {
      fs.mkdirSync(`./archive`);
    }

    return extString;
  } catch (err) {
    console.log(chalk.red(`   Error staging extension`));
    console.log(chalk.red(`   ${err.message}`));
    console.log();

    process.exit(1);
  }
}

// This is sloppy. Surely there's a better async/await way with reliable results,
//    but first few attempts have failed ('invalid arguments' when pointing to parent dir?)
function signCommands(path, rootpath, password, includeZip) {
  return new Promise((resolve, reject) => {
    let certInfo;
    if (fs.existsSync(`./.certinfo`)) {
      certInfo = fs.readFileSync(`./.certinfo`, {
        encoding: "utf-8",
      });
    } else {
      certInfo = "US;NY;SomeOrg;SomeName";
      fs.writeFileSync(`./.certinfo`, certInfo);
    }
    certInfo = certInfo.split(";");
    shell.cd(`..`);
    console.log("");
    console.log(
      `${utils.osPrefix}ZXPSignCmd -selfSignedCert ${certInfo[0]} ${certInfo[1]} ${certInfo[2]} ${certInfo[3]} ${password} ./${rootpath}/archive/temp1.p12`
    );
    shell.exec(
      `${utils.osPrefix}ZXPSignCmd -selfSignedCert ${certInfo[0]} ${certInfo[1]} ${certInfo[2]} ${certInfo[3]} ${password} ./${rootpath}/archive/temp1.p12`
    );
    setTimeout(() => {
      console.log("");
      console.log(
        `${utils.osPrefix}ZXPSignCmd -sign ./${path}-tmp ./${rootpath}/archive/${path}.zxp ./${rootpath}/archive/temp1.p12 ${password} -tsa http://time.certum.pl`
      );
      shell.exec(
        `${utils.osPrefix}ZXPSignCmd -sign ./${path}-tmp ./${rootpath}/archive/${path}.zxp ./${rootpath}/archive/temp1.p12 ${password} -tsa http://time.certum.pl`
      );

      if (includeZip)
        setTimeout(() => {
          shell.exec(
            `${utils.osPrefix}ZXPSignCmd -sign ./${path}-tmp ./${rootpath}/archive/${path}.zip ./${rootpath}/archive/temp1.p12 ${password} -tsa http://time.certum.pl`
          );
        }, 1000);
      setTimeout(() => {
        console.log("");
        console.log(
          `${utils.osPrefix}ZXPSignCmd -verify ./${rootpath}/archive/${path}.zxp -certinfo`
        );
        shell.exec(
          `${utils.osPrefix}ZXPSignCmd -verify ./${rootpath}/archive/${path}.zxp -certinfo`
        );

        resolve();
      }, 1000);
    }, 1000);
  }).catch((err) => {
    //
    console.log(err);
  });
}
