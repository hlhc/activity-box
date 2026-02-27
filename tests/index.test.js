import * as core from '@actions/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GistBox, checkAllowedEvents, checkRequiredSecrets, main, run } from '../index.js'

// Capture the real prototype methods before any test replaces them
const _realGistBoxUpdate = GistBox.prototype.update

const mockRequest = vi.hoisted(() => vi.fn())
const mockListPublicEventsForUser = vi.hoisted(() => vi.fn())

vi.mock('@octokit/request', () => ({ request: mockRequest }))
vi.mock('@actions/core')

beforeEach(() => {
  vi.clearAllMocks()
  mockRequest.mockResolvedValue({ data: { files: { 'pinned.md': {} } } })
})

vi.mock('@actions/github', () => ({
  getOctokit: vi.fn(() => ({
    rest: {
      activity: {
        listPublicEventsForUser: mockListPublicEventsForUser,
      },
    },
  })),
}))

const events = [
  {
    type: 'IssuesEvent',
    repo: { name: 'clippy/take-over-github' },
    payload: { action: 'opened', issue: { number: 1 } },
  },
  {
    type: 'IssueCommentEvent',
    repo: { name: 'clippy/take-over-github' },
    payload: { action: 'closed', issue: { number: 1 } },
  },
  {
    type: 'PullRequestEvent',
    repo: { name: 'clippy/take-over-github' },
    payload: { action: 'closed', pull_request: { number: 2, merged: true } },
  },
  {
    type: 'PullRequestEvent',
    repo: { name: 'clippy/take-over-github' },
    payload: { action: 'closed', pull_request: { number: 3, merged: false } },
  },
  {
    type: 'PullRequestEvent',
    repo: {
      name: 'clippy/really-really-really-really-really-really-really-really-really-long',
    },
    payload: { action: 'opened', pull_request: { number: 3 } },
  },
]

describe('activity-box', () => {
  beforeEach(() => {
    GistBox.prototype.update = vi.fn()
    mockListPublicEventsForUser.mockResolvedValue({ data: events })
  })

  it('updates the Gist with the expected string', async () => {
    await run()
    expect(GistBox.prototype.update).toHaveBeenCalled()
    expect(GistBox.prototype.update.mock.calls[0][0]).toMatchSnapshot()
  })

  it('handles failure to update the Gist', async () => {
    GistBox.prototype.update.mockImplementationOnce(() => {
      throw new Error(404)
    })

    await run()
    expect(core.setFailed).toHaveBeenCalled()
    expect(core.setFailed.mock.calls).toMatchSnapshot()
  })

  it('sets content to "No recent activity." when no events match', async () => {
    mockListPublicEventsForUser.mockResolvedValue({ data: [] })
    await run()
    expect(GistBox.prototype.update).toHaveBeenCalledWith({
      content: 'No recent activity.',
    })
  })

  it('main() calls run and propagates errors via core.setFailed', async () => {
    main()
    await vi.waitFor(() => expect(GistBox.prototype.update).toHaveBeenCalled())
  })
})

describe('checkRequiredSecrets', () => {
  it('does nothing when called with no arguments', () => {
    expect(() => checkRequiredSecrets()).not.toThrow()
  })

  it('does nothing when called with an empty array', () => {
    expect(() => checkRequiredSecrets([])).not.toThrow()
  })

  it('does nothing when all required secrets are present', () => {
    expect(() => checkRequiredSecrets(['GH_PAT', 'GIST_ID', 'GH_USERNAME'])).not.toThrow()
  })

  it('throws and calls core.setFailed when a secret is missing', () => {
    expect(() => checkRequiredSecrets(['GH_PAT', 'MISSING_SECRET'])).toThrow()
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('MISSING_SECRET')
    )
  })
})

describe('checkAllowedEvents', () => {
  afterEach(() => {
    delete process.env.GITHUB_EVENT_NAME
  })

  it('does nothing when called with no arguments', () => {
    expect(() => checkAllowedEvents()).not.toThrow()
  })

  it('does nothing when the current event matches a string', () => {
    process.env.GITHUB_EVENT_NAME = 'push'
    expect(() => checkAllowedEvents('push')).not.toThrow()
  })

  it('does nothing when the current event is in the allowed array', () => {
    process.env.GITHUB_EVENT_NAME = 'schedule'
    expect(() => checkAllowedEvents(['push', 'schedule'])).not.toThrow()
  })

  it('throws and calls core.warning when the event is not allowed (string)', () => {
    process.env.GITHUB_EVENT_NAME = 'pull_request'
    expect(() => checkAllowedEvents('push')).toThrow()
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('pull_request'))
  })

  it('throws and calls core.warning when the event is not in the allowed array', () => {
    process.env.GITHUB_EVENT_NAME = 'pull_request'
    expect(() => checkAllowedEvents(['push', 'schedule'])).toThrow()
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('pull_request'))
  })

  it('defaults GITHUB_EVENT_NAME to empty string when it is not set', () => {
    delete process.env.GITHUB_EVENT_NAME
    expect(() => checkAllowedEvents('push')).toThrow()
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('``'))
  })

  it('includes the action suffix in the message when GITHUB_ACTION is set', () => {
    process.env.GITHUB_EVENT_NAME = 'push'
    process.env.GITHUB_ACTION = 'my_action'
    expect(() => checkAllowedEvents('schedule')).toThrow()
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('.my_action'))
    delete process.env.GITHUB_ACTION
  })
})

describe('GistBox', () => {
  const box = new GistBox({ id: 'gist123', token: 'tok456' })
  const authHeader = { authorization: 'token tok456' }

  beforeEach(() => {
    // activity-box's beforeEach replaces update with vi.fn(); restore it here
    GistBox.prototype.update = _realGistBoxUpdate
  })

  it('get() calls GET /gists/{gist_id} with the correct params', async () => {
    await box.get()
    expect(mockRequest).toHaveBeenCalledWith('GET /gists/{gist_id}', {
      gist_id: 'gist123',
      headers: authHeader,
    })
  })

  it('update() calls PATCH /gists/{gist_id} using the filename from get()', async () => {
    await box.update({ content: 'hello' })
    expect(mockRequest).toHaveBeenCalledWith('PATCH /gists/{gist_id}', {
      files: { 'pinned.md': { content: 'hello' } },
      gist_id: 'gist123',
      headers: authHeader,
    })
  })
})
