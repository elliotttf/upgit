'use strict';

const fs = require('fs-extra-promise');
const path = require('path');
const { tmpDir } = require('os');
const { Clone, Cred, Diff, Signature } = require('nodegit');
const GitHub = require('github-api');

/**
 * @class
 */
class UpGit {
  /**
   * @param {object} source
   *   The source repository to merge changes to.
   *   - name
   *   - repoUrl
   *   - filePath
   *   - baseBranch
   * @param {object} target
   *   The target repository to merge changes from.
   *   - name
   *   - repoUrl
   *   - filePath
   * @param {object} author
   *   Author information for signing commits.
   *   - name
   *   - email
   * @param {object} github
   *   The github user and token to create a pull request with.
   *   - user
   *   - token
   */
  constructor(source, target, author, github) {
    this.id = `${Date.now()}-${source.name}`;

    this.source = source;
    this.target = target;
    this.author = author;
    this.defaultOpts = {
      callbacks: {
        certificateCheck() {
          return 1;
        },
        credentials(url, userName) {
          return Cred.sshKeyFromAgent(userName);
        },
      },
    };

    this.githubUser = github.user;
    this.gh = new GitHub({ token: github.token });
  }

  /**
   * Runs through the process of checking if there's a difference between the
   * source and target repositories, applies the diff, commits the dif, creates
   * a branch, pushes the branch, and opens a PR on the source repo.
   *
   * @return {Promise}
   *   Resolves when the PR is opened or if no PR is needed, rejects on error.
   */
  pullIfNeeded() {
    return this.clone()
      .then(() => this.createSourceBranch())
      .then(() => this.applyTarget())
      .then(() => this.getDiff())
      .then((diff) => {
        if (diff.numDeltas() === 0) {
          return Promise.reject('up to date');
        }

        return this.commit(diff);
      })
      .then(() => this.push())
      .then(() => this.openPR())
      .catch((err) => {
        if (err === 'up to date') {
          return Promise.resolve(err);
        }

        return Promise.reject(err);
      });
  }

  /**
   * Clones a repository
   *
   * @return {[Promise]}
   *   Resolves with an array of Repository objects when the repositories have
   *   been cloned.
   */
  clone() {
    const sourceClonePath = path.join(tmpDir(), `${this.id}-${this.source.name}`);
    const targetClonePath = path.join(tmpDir(), `${this.id}-${this.target.name}`);
    return Promise.all([
      Clone.clone(this.source.repoUrl, sourceClonePath, { fetchOpts: this.defaultOpts }),
      Clone.clone(this.target.repoUrl, targetClonePath, { fetchOpts: this.defaultOpts }),
    ])
      .then((repositories) => {
        [this.sourceRepo, this.targetRepo] = repositories;
      })
      .then(() => this.sourceRepo.getHeadCommit())
      .then((commit) => {
        this.sourceHeadCommit = commit;
      });
  }

  /**
   * Creates the working branch on the source repository.
   *
   * @return {Promise}
   *   Returns when the branch has been created and checked out.
   */
  createSourceBranch() {
    return this.sourceRepo.createBranch(this.id, this.sourceHeadCommit)
      .then(() => this.sourceRepo.checkoutBranch(this.id));
  }

  /**
   * Applies the file(s) from the target on the source repo.
   *
   * @return {Promise}
   *   Resolves when the target's file(s) have been applied to the source repo.
   */
  applyTarget() {
    const sourcePath = path.resolve(path.join(
      this.sourceRepo.path(),
      '..',
      this.source.filePath
    ));
    const targetPath = path.resolve(path.join(
      this.targetRepo.path(),
      '..',
      this.target.filePath
    ));
    return fs.copyAsync(targetPath, sourcePath);
  }

  /**
   * Gets the diff, if any, on the source repo.
   *
   * @return {Promise}
   *   Resolves with the diff object.
   */
  getDiff() {
    return this.sourceHeadCommit.getTree()
      .then(tree => Diff.treeToWorkdir(this.sourceRepo, tree));
  }

  /**
   * Commits the diff to the source repo.
   *
   * @param {Diff} diff
   *   The difference object for the source repo.
   *
   * @return {Promise}
   *   Resolves when the diff has been committed.
   */
  commit(diff) {
    const { name, email } = this.author;
    const files = [];
    for (let x = 0; x < diff.numDeltas(); x += 1) {
      const delta = diff.getDelta(x);
      files.push(delta.newFile().path());
    }
    return this.sourceRepo.createCommitOnHead(
      files,
      Signature.now(name, email),
      Signature.now(name, email),
      `Automatic update of ${this.source.name} from ${this.target.name}.`
    );
  }

  /**
   * Pushes the branch to the source's origin remote.
   *
   * @return {Promise}
   *   Resolves when the branch has been pushed.
   */
  push() {
    return this.sourceRepo.getRemote('origin')
      .then(remote => remote.push(
        [`refs/heads/${this.id}:refs/heads/${this.id}`],
        this.defaultOpts
      ));
  }

  /**
   * Opens a pull request on the source's repo with the working branch.
   *
   * @return {Promise}
   *   Resolves when the pull request is open.
   */
  openPR() {
    return this.gh.getRepo(this.githubUser, this.source.name).createPullRequest({
      title: `Automatic update of ${this.source.name} from ${this.target.name}`,
      head: this.id,
      base: this.source.baseBranch,
    });
  }
}

module.exports = UpGit;

