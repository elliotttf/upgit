# Up Git

This module will allow you to target a file or files from one repository
(the target) and the same file or files in another (the source). A diff
between files will open a pull request on the source repository.

## Usage

```javascript
const UpGit = reqiure('upgit');
const ug = new UpGit(
  // This is info about the repo you're applying changes _to_.
  {
    name: SOURCE_REPO_NAME,
    repoUrl: SOURCE_REPO_URL,
    filePath: SOURCE_TARGET_FILE_PATH,
    baseBranch: BASE_BRANCH,
  },
  // This is info about the repo you're applying changes _from_.
  {
    name: TARGET_REPO_NAME,
    repoUrl: TARGET_REPO_URL,
    filePath: TARGET_TARGET_FILE_PATH,
  },
  // This is info about the committer.
  {
    name: COMMITTER_NAME,
    email: COMMITTER_EMAIL,
  },
  // This is a github info to use when opening the PR.
  {
    user: GITHUB_USER,
    token: GITHUB_TOKEN,
  }
);

ug.pullIfNeeded()
  .then(res => {
    if (res === 'up to date') {
      return console.log('no updates needed.');
    }
    console.log('pull request opened.');
  });
```
