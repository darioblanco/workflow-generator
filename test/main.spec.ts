import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { getInput, setFailed } from '@actions/core';
import { resolve as pathResolve } from 'path';

import { run } from '@darioblanco/workflow-generator/main';

jest.mock('@actions/core');
jest.mock('@actions/exec', () => ({
  exec: jest.fn(),
}));
jest.mock('@actions/github', () => ({
  context: {
    ref: 'refs/heads/main',
    repo: {
      owner: 'theowner',
      repo: 'therepo',
    },
  },
  getOctokit: jest.fn().mockReturnValue({
    rest: {
      repos: {
        getContent: jest.fn().mockResolvedValue({
          data: {
            content: fs.readFileSync(pathResolve(__dirname, 'workflow-creator.yaml'), 'base64'),
          },
        }),
      },
    },
  }),
}));

describe('run', () => {
  // Required input values
  const config = 'workflow-generator.yml';
  const outputFiles = '.github/workflows';
  const templatePath = 'ytt';
  const token = 'secret';

  test('with required params', async () => {
    (getInput as jest.Mock).mockImplementation((name: string) => {
      switch (name) {
        case 'config':
          return config;
        case 'outputFiles':
          return outputFiles;
        case 'templatePath':
          return templatePath;
        case 'token':
          return token;
        default:
          return undefined;
      }
    });

    await run();
    expect(setFailed).not.toBeCalled();
  });

  test('unexpected error', async () => {
    const errorMsg = 'fake';
    (getInput as jest.Mock).mockImplementation(() => {
      throw new Error(errorMsg);
    });

    await run();
    expect(setFailed).toBeCalledWith(errorMsg);
  });
});
