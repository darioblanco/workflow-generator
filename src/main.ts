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
    core.debug(`Config content:\n ${JSON.stringify(config)}`);
    console.log(`Config content:\n ${JSON.stringify(config)}`);
    await exec.exec('pwd', [], {
      listeners: {
        stdout: (data: Buffer) => core.debug(`Current folder: ${data.toString()}`),
      },
    });
    // Generate YTT templates for global workflows
    const globalExtraParams: string[] = [];
    config.global.workflows.forEach((workflow) => {
      globalExtraParams.push(`--file-mark '${workflow}:exclusive-for-output=true'`);
    });
    if (config.global.values) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
      const serializedValues = yaml.dump(config.global.values);
      fs.writeFileSync('global.yml', serializedValues);
      globalExtraParams.push(`--data-values-file global.yml`);
    }
    await exec.exec(
      'ytt',
      [`-f ${templatePath}`, `--output-files ${outputFiles}`].concat(globalExtraParams),
    );
    // Generate YTT templates for scoped workflows
    for (const scope of config.scoped) {
      const scopeExtraParams: string[] = [];
      scope.workflows.forEach((workflow) => {
        scopeExtraParams.push(`--file-mark '${workflow}:exclusive-for-output=true'`);
      });
      if (scope.values) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const serializedValues = yaml.dump(config.global.values);
        fs.writeFileSync('global.yml', serializedValues);
        scopeExtraParams.push(`--data-values-file global.yml`);
      }
      await exec.exec(
        'ytt',
        [`-f ${templatePath}`, `--output-files ${outputFiles}`].concat(scopeExtraParams),
      );
    }
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}
