import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import * as io from '@actions/io';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { GitHub } from '@actions/github/lib/utils';
import { join as pathJoin, resolve as pathResolve } from 'path';

import { Config } from './types';

function createOctokit() {
  const token = core.getInput('token');
  if (token) {
    return github.getOctokit(token);
  } else {
    core.warning(
      'No token set, you may experience rate limiting. Set "token: ${{ github.token }}" if you have problems.',
    );
    return new GitHub();
  }
}

const cwd = process.cwd();

export async function run(): Promise<void> {
  try {
    const { owner, repo } = github.context.repo;
    const { ref } = github.context;

    const configPath = pathJoin('.github', core.getInput('config'));
    const outputFiles = pathResolve(cwd, core.getInput('outputFiles'));
    const templatePaths = core.getInput('templatePaths').split(',');
    core.debug(
      `Configuration: ${JSON.stringify({
        configPath,
        outputFiles,
        templatePaths,
      })}`,
    );

    // Retrieve workflow configuration
    const octokit = createOctokit();
    core.debug(`Retrieving content from repo ${repo} (${ref}) in expected path ${configPath}`);
    const contentResponse = await octokit.rest.repos.getContent({
      owner,
      ref,
      repo,
      path: configPath,
    });
    let config: Config;
    if ('content' in contentResponse.data) {
      const content = Buffer.from(contentResponse.data.content, 'base64').toString('utf8');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      config = yaml.load(content) as Config;
    } else {
      throw new Error(`Unable to load config from ${configPath}`);
    }
    // Show config, current folder and templates
    core.debug(`Config content loaded from ${configPath} via octokit:\n ${JSON.stringify(config)}`);
    if (core.isDebug()) {
      core.debug('Current working directory:');
      await exec.exec('pwd');
      core.debug('Current working directory contents:');
      await exec.exec('ls -allh');
      for (const templatePath of templatePaths) {
        const templateResolvedPath = pathResolve(cwd, templatePath);
        core.debug(`Template directory ${templateResolvedPath} contents:`);
        await exec.exec(`ls -allh ${templateResolvedPath}`);
      }
      core.debug('Output folder contents:');
      await exec.exec(`ls -allh ${outputFiles}`);
    }

    // Create temporary directory
    const tmpDir = pathResolve(cwd, '.github', 'tmp');
    await io.mkdirP(tmpDir);
    core.debug(`Created temporary directory in ${tmpDir}`);

    // Generate YTT templates for global workflows
    const templateCommandParams = () =>
      templatePaths.reduce<string[]>(
        (commandParams, templatePath) => commandParams.concat('-f', pathResolve(cwd, templatePath)),
        [],
      );
    const globalExtraParams: string[] = templateCommandParams();
    config.global.workflows.forEach(({ file, overlays }) => {
      globalExtraParams.push('--file-mark');
      globalExtraParams.push(`${file}:exclusive-for-output=true`);
      if (overlays) {
        overlays.forEach((overlay) => {
          globalExtraParams.push('--file-mark');
          globalExtraParams.push(`${overlay}:exclusive-for-output=true`);
        });
      }
    });
    if (!config.global) {
      throw Error(`The "global" configuration key is required in ${configPath}`);
    }
    if (config.global.values) {
      const globalValuesPath = pathJoin(tmpDir, 'global.yml');
      core.debug(`Generating global values in ${globalValuesPath}...`);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
      const serializedValues = yaml.dump(config.global.values);
      fs.writeFileSync(globalValuesPath, serializedValues);
      globalExtraParams.push('--data-values-file');
      globalExtraParams.push(globalValuesPath);
    }
    await exec.exec('ytt', ['--output-files', outputFiles].concat(globalExtraParams), {
      listeners: {
        stdout: (data: Buffer) => core.debug(data.toString()),
        stderr: (error: Buffer) => core.error(error.toString()),
      },
    });
    // Generate YTT templates for scoped workflows (if defined)
    for (const scope of config.scoped || []) {
      const scopeValuesPath = pathJoin(tmpDir, `${scope.name}.yml`);
      core.debug(`Generating ${scope.name} scope values in ${scopeValuesPath}...`);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
      const serializedValues: string = yaml.dump(scope.values);
      core.debug(`Serialized values:\n${serializedValues}`);
      fs.writeFileSync(scopeValuesPath, serializedValues);
      for (const { file: workflowFile, overlays } of scope.workflows) {
        const workflowBits = workflowFile.split('.');
        const scopeWorkflowName = workflowBits
          .slice(0, -1)
          .concat(scope.name, workflowBits.slice(-1))
          .join('.');
        const scopeWorkflowPath = pathJoin(outputFiles, scopeWorkflowName);
        core.debug(`Process workflow ${workflowFile} into ${scopeWorkflowPath} ...`);
        const fileMarks = ['--file-mark', `${workflowFile}:exclusive-for-output=true`];
        if (overlays) {
          overlays.forEach((overlay) => {
            fileMarks.push('--file-mark');
            fileMarks.push(`${overlay}:exclusive-for-output=true`);
          });
        }
        await exec.exec(
          'ytt',
          ['--data-values-file', scopeValuesPath].concat(templateCommandParams(), fileMarks),
          {
            listeners: {
              stdout: (data: Buffer) => fs.writeFileSync(scopeWorkflowPath, data),
              stderr: (error: Buffer) => core.error(error.toString()),
            },
          },
        );
      }
    }

    // Delete temporary directory
    await io.rmRF(tmpDir);
    core.debug(`Deleted temporary directory in ${tmpDir}`);
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}
