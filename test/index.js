'use strict';

const fs = require('fs-extra-promise');
const path = require('path');
const sinon = require('sinon');
const { tmpDir } = require('os');
const GitHub = require('github-api');
const UpGit = require('../');
const { Clone, Cred, Diff, Time } = require('nodegit');


module.exports = {
  setUp(cb) {
    this.clock = sinon.useFakeTimers();
    this.ug = new UpGit(
      {
        name: 'test-repo',
        repoUrl: 'git@github.com:test-user/test-repo.git',
        filePath: 'testFile.js',
        baseBranch: 'master',
      },
      {
        name: 'target-test-repo',
        repoUrl: 'git@github.com:test-user/target-test-repo.git',
        filePath: 'lib/testFile.js',
      },
      {
        name: 'test-user',
        email: 'test-user@example.com',
      },
      {
        user: 'test-user',
        token: 'test-token',
      }
    );
    this.stubs = [];
    cb();
  },
  tearDown(cb) {
    this.clock.restore();
    this.stubs.forEach(stub => stub.restore());
    cb();
  },
  constructor(test) {
    test.expect(3);
    test.equals(this.ug.id, '0-test-repo');
    test.equals(this.ug.githubUser, 'test-user');
    test.ok(this.ug.gh instanceof GitHub);
    test.done();
  },
  defaultOpts: {
    certificateCheck(test) {
      test.expect(1);
      test.equal(this.ug.defaultOpts.callbacks.certificateCheck(), 1);
      test.done();
    },
    credentials(test) {
      test.expect(2);
      this.stubs.push(sinon.stub(Cred, 'sshKeyFromAgent', (name) => {
        test.equal(name, 'test-user');
        return 'test-cred';
      }));
      test.equal(
        this.ug.defaultOpts.callbacks.credentials(
          'http://example.com',
          'test-user'
        ),
        'test-cred'
      );
      test.done();
    },
  },
  pullIfNeeded: {
    setUp(cb) {
      this.stubs.push(sinon.stub(this.ug, 'clone', () => Promise.resolve()));
      this.stubs.push(sinon.stub(this.ug, 'createSourceBranch', () => Promise.resolve()));
      this.stubs.push(sinon.stub(this.ug, 'applyTarget', () => Promise.resolve()));
      this.stubs.push(sinon.stub(this.ug, 'commit', () => Promise.resolve()));
      this.stubs.push(sinon.stub(this.ug, 'push', () => Promise.resolve()));
      this.stubs.push(sinon.stub(this.ug, 'openPR', () => Promise.resolve()));
      cb();
    },
    upToDate(test) {
      test.expect(1);
      this.stubs.push(sinon.stub(this.ug, 'getDiff', () => Promise.resolve({
        numDeltas() {
          return 0;
        },
      })));

      this.ug.pullIfNeeded()
        .then((res) => {
          test.equal(res, 'up to date');
          test.done();
        })
        .catch(() => test.done());
    },
    fail(test) {
      test.expect(1);
      this.stubs.push(sinon.stub(this.ug, 'getDiff', () => Promise.reject('fail')));
      this.ug.pullIfNeeded()
        .then(() => test.done())
        .catch((err) => {
          test.equal(err, 'fail');
          test.done();
        });
    },
    success(test) {
      test.expect(1);
      this.stubs.push(sinon.stub(this.ug, 'getDiff', () => Promise.resolve({
        numDeltas() {
          return 1;
        },
      })));
      this.ug.pullIfNeeded()
        .then(() => {
          test.ok(true);
          test.done();
        })
        .catch(() => test.done());
    },
  },
  clone(test) {
    test.expect(3);

    this.stubs.push(sinon.stub(
      Clone,
      'clone',
      (repoUrl, clonePath) => {
        if (repoUrl === 'git@github.com:test-user/test-repo.git') {
          test.equals(clonePath, path.join(tmpDir(), '0-test-repo-test-repo'));
          return Promise.resolve({
            getHeadCommit() {
              return 'test-commit';
            },
          });
        }
        else if (repoUrl === 'git@github.com:test-user/target-test-repo.git') {
          test.equals(clonePath, path.join(tmpDir(), '0-test-repo-target-test-repo'));
          return Promise.resolve({ });
        }
        return Promise.reject();
      }
    ));

    this.ug.clone()
      .then(() => {
        test.equals(this.ug.sourceHeadCommit, 'test-commit');
        test.done();
      })
      .catch(() => test.done());
  },
  createSourceBranch(test) {
    test.expect(3);
    this.ug.sourceHeadCommit = 'test-commit';
    this.ug.sourceRepo = {
      createBranch(id, headCommit) {
        test.equal(id, '0-test-repo');
        test.equal(headCommit, 'test-commit');
        return Promise.resolve();
      },
      checkoutBranch(id) {
        test.equal(id, '0-test-repo');
        return Promise.resolve();
      },
    };

    this.ug.createSourceBranch()
      .then(() => test.done())
      .catch(() => test.done());
  },
  applyTarget(test) {
    test.expect(2);
    this.ug.sourceRepo = {
      path() {
        return '/tmp/source-repo/.git';
      },
    };
    this.ug.targetRepo = {
      path() {
        return '/tmp/target-repo/.git';
      },
    };
    this.stubs.push(sinon.stub(fs, 'copyAsync', (from, to) => {
      test.equal(from, '/tmp/target-repo/lib/testFile.js');
      test.equal(to, '/tmp/source-repo/testFile.js');
      return Promise.resolve();
    }));

    this.ug.applyTarget()
      .then(() => test.done())
      .catch(() => test.done());
  },
  getDiff(test) {
    test.expect(2);
    this.ug.sourceRepo = 'test-repo';
    this.ug.sourceHeadCommit = {
      getTree() {
        return Promise.resolve('test-tree');
      },
    };
    this.stubs.push(sinon.stub(Diff, 'treeToWorkdir', (repo, tree) => {
      test.equal(repo, 'test-repo');
      test.equal(tree, 'test-tree');
      return Promise.resolve();
    }));

    this.ug.getDiff()
      .then(() => test.done())
      .catch(() => test.done());
  },
  commit(test) {
    test.expect(8);
    const diff = {
      numDeltas() {
        return 1;
      },
      getDelta() {
        return {
          newFile() {
            return {
              path() {
                return '/tmp/source-repo/testFile.js';
              },
            };
          },
        };
      },
    };
    this.ug.sourceRepo = {
      createCommitOnHead(files, author, committer, message) {
        test.deepEqual(files, ['/tmp/source-repo/testFile.js']);
        test.equal(author.name(), 'test-user');
        test.equal(committer.name(), 'test-user');
        test.equal(author.email(), 'test-user@example.com');
        test.equal(committer.email(), 'test-user@example.com');
        test.ok(author.when() instanceof Time);
        test.ok(committer.when() instanceof Time);
        test.equal(message, 'Automatic update of test-repo from target-test-repo.');
        return Promise.resolve();
      },
    };
    this.ug.commit(diff)
      .then(() => test.done())
      .catch(() => test.done());
  },
  push(test) {
    test.expect(1);
    this.ug.sourceRepo = {
      getRemote(remote) {
        test.equal(remote, 'origin');
        return Promise.resolve((refs) => {
          test.deepEqual(refs, ['refs/heads/0-test-repo:refs/heads/0-test-repo']);
          return Promise.resolve();
        });
      },
    };

    this.ug.push()
      .then(() => test.done())
      .catch(() => test.done());
  },
  openPR(test) {
    test.expect(3);
    this.stubs.push(sinon.stub(this.ug.gh, 'getRepo', (user, repo) => {
      test.equal(user, 'test-user');
      test.equal(repo, 'test-repo');
      return {
        createPullRequest(opts) {
          test.deepEqual(
            opts,
            {
              title: 'Automatic update of test-repo from target-test-repo',
              head: '0-test-repo',
              base: 'master',
            }
          );
          return Promise.resolve();
        },
      };
    }));

    this.ug.openPR()
      .then(() => test.done())
      .catch(() => test.done());
  },
};

