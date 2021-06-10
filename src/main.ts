import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
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

export async function run(): Promise<void> {
  try {
    const { owner, repo } = github.context.repo;
    const { ref } = github.context;

    const configPath = pathJoin('.github', core.getInput('config'));
    const outputFiles = pathResolve(__dirname, core.getInput('outputFiles'));
    const templatePath = pathResolve(__dirname, core.getInput('templatePath'));
    core.debug(
      `Configuration: ${JSON.stringify({
        configPath,
        outputFiles,
        templatePath,
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
      throw new Error(`Unable to load config from ${templatePath}`);
    }
    // Show config, current folder and templates
    core.debug(`Config content:\n ${JSON.stringify(config)}`);
    await exec.exec('ls -allh', [], {
      listeners: {
        stdout: (data: Buffer) => core.debug(`Current folder\n: ${data.toString()}`),
      },
    });
    await exec.exec(`ls -allh ${templatePath}`, [], {
      listeners: {
        stdout: (data: Buffer) => core.debug(`Template folder\n: ${data.toString()}`),
      },
    });
    // Generate YTT templates for global workflows
    const globalExtraParams: string[] = [];
    config.global.workflows.forEach((workflow) => {
      globalExtraParams.push('--file-mark');
      globalExtraParams.push(`'${workflow}:exclusive-for-output=true'`);
    });
    if (config.global.values) {
      const globalValuesPath = pathResolve(__dirname, 'global.yml');
      core.debug(`Generating global values in ${globalValuesPath}...`);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
      const serializedValues = yaml.dump(config.global.values);
      fs.writeFileSync(globalValuesPath, serializedValues);
      globalExtraParams.push('--data-values-file');
      globalExtraParams.push(globalValuesPath);
    }
    await exec.exec(
      'ytt',
      ['-f', templatePath, '--output-files', outputFiles].concat(globalExtraParams),
      {
        listeners: {
          stdout: (data: Buffer) => core.debug(data.toString()),
          stderr: (error: Buffer) => core.error(error.toString()),
        },
      },
    );
    // Generate YTT templates for scoped workflows
    for (const scope of config.scoped) {
      const scopeValuesPath = pathResolve(__dirname, `${scope.name}.yml`);
      core.debug(`Generating ${scope.name} scope values in ${scopeValuesPath}...`);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
      const serializedValues = yaml.dump(config.global.values);
      fs.writeFileSync(scopeValuesPath, serializedValues);
      for (const workflow of scope.workflows) {
        const workflowBits = workflow.split('.');
        const scopeWorkflowName = workflowBits
          .slice(0, -1)
          .concat(scope.name, workflowBits.slice(-1))
          .join('.');
        const scopeWorkflowPath = pathJoin(outputFiles, scopeWorkflowName);
        core.debug(`Process workflow ${workflow} into ${scopeWorkflowPath} ...`);
        await exec.exec(
          'ytt',
          [
            '-f',
            templatePath,
            '--data-values-file',
            scopeValuesPath,
            '--file-mark',
            `'${workflow}:exclusive-for-output=true'`,
          ],
          {
            listeners: {
              stdout: (data: Buffer) => fs.writeFileSync(scopeWorkflowPath, data),
              stderr: (error: Buffer) => core.error(error.toString()),
            },
          },
        );
      }
    }
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}
