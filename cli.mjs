#!/usr/bin/env node

import { cancel, intro, outro, select, spinner, text } from '@clack/prompts'
import { execa } from 'execa'
import { inc, valid } from 'semver'

async function run() {
  intro('Starting screw-it...')
  const ctx = {}

  // Validate Environment

  // 1. Check git repository
  let s = spinner()
  s.start('Checking git repository...')
  try {
    await checkGitRepo()
    s.stop('Git repository validated')
  } catch (err) {
    s.stop(err.message)
    cancel('Exiting...')
    process.exit(1)
  }

  // 2. Check git status
  s = spinner()
  s.start('Checking git status...')
  try {
    await getGitStatus()
    s.stop('Working tree is clean')
  } catch (err) {
    s.stop(err.message)
    cancel('Exiting...')
    process.exit(1)
  }

  // 3. Validate package version
  s = spinner()
  s.start('Validating package version...')
  try {
    await getPackageVersion(ctx)
    s.stop(`Package version is ${ctx.currentVersion}`)
  } catch (err) {
    s.stop(err.message)
    cancel('Exiting...')
    process.exit(1)
  }

  // 4. Check registry version
  s = spinner()
  s.start('Checking registry version...')
  try {
    await checkRegistryVersion(ctx)
    s.stop('Registry version OK')
  } catch (err) {
    s.stop(err.message)
    cancel('Exiting...')
    process.exit(1)
  }

  // Publishing

  // 5. Bump version
  s = spinner()
  s.start('Bumping version...')
  try {
    await bumpVersion(ctx)
    s.stop(`Version bumped to ${ctx.newVersion}`)
  } catch (err) {
    s.stop(err.message)
    cancel('Exiting...')
    process.exit(1)
  }

  // 6. Publish to npm
  s = spinner()
  s.start('Publishing to npm...')
  try {
    await publishToNpm(ctx)
    s.stop('Published to npm')
  } catch (err) {
    s.stop(err.message)
    cancel('Exiting...')
    process.exit(1)
  }

  // 7. Create git tag and commit
  s = spinner()
  s.start('Creating git tag and commit...')
  try {
    await createGitTagAndCommit(ctx)
    s.stop('Git tag and commit created')
  } catch (err) {
    s.stop(err.message)
    cancel('Exiting...')
    process.exit(1)
  }

  outro(`Successfully published version ${ctx.newVersion}`)
}

async function checkGitRepo() {
  try {
    await execa('git', ['rev-parse', '--is-inside-work-tree'])
  } catch (err) {
    throw new Error('Not a git repository')
  }
}

async function getGitStatus() {
  const { stdout } = await execa('git', ['status', '--porcelain'])
  if (stdout !== '') {
    throw new Error('Unclean working tree. Commit or stash changes first.')
  }
}

async function getPackageVersion(ctx) {
  const { stdout } = await execa('npm', ['pkg', 'get', 'version'])
  const version = stdout.replace(/"/g, '')
  const parsedVersion = valid(version)
  if (!parsedVersion) {
    throw new Error('Invalid semver version in package.json')
  }
  ctx.currentVersion = parsedVersion
}

async function checkRegistryVersion(ctx) {
  try {
    const { stdout } = await execa('npm', ['view', '.', 'version'])
    ctx.registryVersion = stdout.trim()
    if (ctx.registryVersion === ctx.currentVersion) {
      throw new Error('Version already exists on registry')
    }
  } catch (err) {
    if (!err.message.includes('npm error code E404')) {
      throw err
    }
    // Package doesn't exist yet, that's fine
  }
}

async function bumpVersion(ctx) {
  const versions = [
    'patch',
    'minor',
    'major',
    'premajor',
    'preminor',
    'prepatch',
    'prerelease',
    'release',
  ].map(type => ({
    type,
    version: inc(ctx.currentVersion, type),
  }))

  const choice = await select({
    message: 'Select version:',
    options: versions.map(v => ({
      value: v,
      label: `${v.type} - ${v.version}`,
    })),
  })

  if (!choice) {
    throw new Error('No version selected')
  }

  try {
    await execa('npm', ['version', choice.version, '--no-git-tag-version'])
    ctx.newVersion = choice.version
  } catch (err) {
    throw new Error('Failed to bump version: ' + err.message)
  }
}

async function publishToNpm(ctx) {
  try {
    await execa('npm', ['publish'])
  } catch (err) {
    if (
      err.message.includes('one-time passcode') ||
      err.message.includes('OTP')
    ) {
      const otp = await text({ message: 'Enter OTP for npm:' })
      try {
        await execa('npm', ['publish', '--otp', otp])
      } catch (err2) {
        await execa('npm', [
          'version',
          ctx.currentVersion,
          '--no-git-tag-version',
          '--allow-same-version',
        ])
        throw new Error('Failed to publish after OTP: ' + err2.message)
      }
    } else {
      // Revert version on publish failure
      await execa('npm', [
        'version',
        ctx.currentVersion,
        '--no-git-tag-version',
        '--allow-same-version',
      ])
      throw new Error('Failed to publish: ' + err.message)
    }
  }
}

async function createGitTagAndCommit(ctx) {
  await execa('git', ['add', 'package.json'])
  await execa('git', ['commit', '-m', `chore: release v${ctx.newVersion}`])
  await execa('git', ['tag', `v${ctx.newVersion}`])
}

run()
