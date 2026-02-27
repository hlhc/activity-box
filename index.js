import 'dotenv/config'
import { fileURLToPath } from 'url'
import { request } from '@octokit/request'
import * as core from '@actions/core'
import { getOctokit } from '@actions/github'

export const MAX_LENGTH = 63
export const MAX_LINES = 5
export const MAX_WIDTH = 325
export const MAX_HEIGHT = 100

export class GistBox {
  constructor({ id, token }) {
    this.id = id
    this.token = token
  }

  async get() {
    return request('GET /gists/{gist_id}', {
      gist_id: this.id,
      headers: { authorization: `token ${this.token}` }
    })
  }

  async update(updates) {
    const gist = await this.get()
    const filename = Object.keys(gist.data.files)[0]
    return request('PATCH /gists/{gist_id}', {
      files: { [filename]: updates },
      gist_id: this.id,
      headers: { authorization: `token ${this.token}` }
    })
  }
}

const capitalize = str => str.slice(0, 1).toUpperCase() + str.slice(1)
const truncate = str =>
  str.length <= MAX_LENGTH ? str : str.slice(0, MAX_LENGTH - 3) + '...'

const serializers = {
  IssueCommentEvent: item => {
    return `🗣 Commented on #${item.payload.issue.number} in ${item.repo.name}`
  },
  IssuesEvent: item => {
    return `❗️ ${capitalize(item.payload.action)} issue #${
      item.payload.issue.number
    } in ${item.repo.name}`
  },
  PullRequestEvent: item => {
    const emoji = item.payload.action === 'opened' ? '💪' : '❌'
    const line = item.payload.pull_request.merged
      ? '🎉 Merged'
      : `${emoji} ${capitalize(item.payload.action)}`
    return `${line} PR #${item.payload.pull_request.number} in ${item.repo.name}`
  }
}

/**
 * Fail fast if required environment variables / secrets are absent.
 * @param {string[]} [secrets]
 */
export function checkRequiredSecrets(secrets) {
  if (!secrets || secrets.length === 0) return

  const missing = secrets.filter(key => !Object.hasOwn(process.env, key))
  if (missing.length === 0) return

  const list = missing.map(key => `- ${key}`).join('\n')
  const msg = `The following secrets are required for this GitHub Action to run:\n${list}`
  core.setFailed(msg)
  throw new Error(msg)
}

/**
 * Exit neutrally when the triggering event is not in the allowed list.
 * Pass undefined / omit to allow any event.
 * @param {string | string[] | undefined} [allowedEvents]
 */
export function checkAllowedEvents(allowedEvents) {
  if (!allowedEvents) return

  const current = process.env.GITHUB_EVENT_NAME ?? ''
  const allowed = Array.isArray(allowedEvents) ? allowedEvents : [allowedEvents]
  if (allowed.includes(current)) return

  const actionStr = process.env.GITHUB_ACTION ? `.${process.env.GITHUB_ACTION}` : ''
  const msg = `Event \`${current}${actionStr}\` is not supported by this action.`
  core.warning(msg)
  throw new Error(msg)
}

export async function run() {
  checkRequiredSecrets(['GH_PAT', 'GIST_ID', 'GH_USERNAME'])

  const { GIST_ID, GH_USERNAME, GH_PAT } = process.env

  const octokit = getOctokit(GH_PAT)

  // Get the user's public events
  core.debug(`Getting activity for ${GH_USERNAME}`)
  const events = await octokit.rest.activity.listPublicEventsForUser({
    username: GH_USERNAME,
    per_page: 100
  })
  core.debug(`Activity for ${GH_USERNAME}, ${events.data.length} events found.`)

  let content = events.data
    // Filter out any boring activity
    .filter(event => Object.hasOwn(serializers, event.type))
    // We only have five lines to work with
    .slice(0, MAX_LINES)
    // Call the serializer to construct a string
    .map(item => serializers[item.type](item))
    // Truncate if necessary
    .map(truncate)
    // Join items to one string
    .join('\n')

  if (content.trim().length <= 0) {
    content = 'No recent activity.'
  }

  const box = new GistBox({ id: GIST_ID, token: GH_PAT })
  try {
    core.debug(`Updating Gist ${GIST_ID}`)
    await box.update({ content })
    core.info('Gist updated!')
  } catch (err) {
    core.setFailed(err)
  }
}

export function main() {
  run().catch(err => core.setFailed(err))
}

/* v8 ignore next 3 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
