# Slack App Setup: Instructions for a Browser Agent

Hand this file to a browser/computer-use agent. It creates the Slack app that the
conversation-tagging pipeline posts to, and collects three values that must be
returned at the end.

**You must be signed in to the target Slack workspace as a user who can create and
install apps.** If installation requires admin approval, stop at Step 5 and report
that approval is pending.

**Return these three values at the end. Do not skip any.**

| Label | Looks like | Where it comes from |
|---|---|---|
| `SLACK_BOT_TOKEN` | `xoxb-` followed by digits and letters | Step 5 |
| `SLACK_SIGNING_SECRET` | 32 hex characters | Step 6 |
| `SLACK_ANALYSIS_CHANNEL_ID` | `C` followed by 10 or more uppercase letters/digits | Step 8 |

These are credentials. Return them only to the person who gave you this file. Do not
paste them into any website, search box, issue tracker, or chat other than that reply.

---

## Step 1 - Create the app

1. Go to `https://api.slack.com/apps`
2. Click **Create New App**
3. Choose **From scratch**
4. App Name: `Outlier Conversation Insights`
5. Pick the workspace for Outlier, then click **Create App**

You should land on the app's **Basic Information** page. Keep this tab open.

## Step 2 - Name and icon (optional, cosmetic)

On **Basic Information**, scroll to **Display Information**:

- Short description: `Posts AI-tagged summaries of closed resident conversations for team review.`
- Background color: `#1F2D3D`

Click **Save Changes** if you edited anything.

## Step 3 - Add bot scopes

1. In the left sidebar, click **OAuth & Permissions**
2. Scroll to **Scopes** then **Bot Token Scopes**
3. Click **Add an OAuth Scope** and add exactly these two:
   - `chat:write`
   - `channels:history`

Do not add any other scopes. If a scope is already present that is fine, leave it.

> If the analysis channel will be a **private** channel, also add `groups:history`
> and `groups:read`. Only do this if the person who gave you this file said the
> channel is private. Otherwise skip it.

## Step 4 - Enable interactivity

1. In the left sidebar, click **Interactivity & Shortcuts**
2. Toggle **Interactivity** to **On**
3. In **Request URL**, enter exactly:

```
https://pshrrdazlftosdtoevpf.supabase.co/functions/v1/slack-interactions
```

4. Click **Save Changes**

Slack may show a verification warning if the endpoint is not deployed yet. That is
expected. If Slack refuses to save the URL entirely, note that in your report and
continue to Step 5 - this step can be redone later.

## Step 5 - Install the app and get the bot token

1. Go back to **OAuth & Permissions**
2. Scroll to the top and click **Install to Workspace** (or **Reinstall to Workspace**)
3. Review the permission screen and click **Allow**
4. You are returned to **OAuth & Permissions**. Copy the value under
   **Bot User OAuth Token**. It starts with `xoxb-`.

**Record this as `SLACK_BOT_TOKEN`.**

If you see "This app requires approval from an admin", request approval, then stop
and report that the install is pending approval.

## Step 6 - Get the signing secret

1. In the left sidebar, click **Basic Information**
2. Scroll to **App Credentials**
3. Find **Signing Secret** and click **Show**
4. Copy the revealed value (32 hex characters)

**Record this as `SLACK_SIGNING_SECRET`.**

Do not copy the Client Secret or the Verification Token. Those are different fields
on the same panel and neither one is what is needed.

## Step 7 - Create the channel and invite the bot

1. Open the Slack workspace (web app at `https://app.slack.com` is fine)
2. Check whether a channel named `#conversation-insights` already exists.
   - If it exists, use it and skip to the invite below.
   - If not, create it: click the **+** next to Channels, choose **Create a channel**,
     name it `conversation-insights`, set visibility to **Public**, and create it.
3. Open the channel, click the message box, and send exactly:

```
/invite @Outlier Conversation Insights
```

Slack should autocomplete the app name as you type it. Confirm the invite. You should
see a system message saying the app was added to the channel.

If the slash command does not work: click the channel name at the top, go to the
**Integrations** tab, click **Add an App**, find **Outlier Conversation Insights**,
and click **Add**.

## Step 8 - Get the channel ID

1. With `#conversation-insights` open, click the channel name at the top of the window
2. Scroll to the very bottom of the panel that opens
3. You will see **Channel ID** with a value starting with `C`
4. Copy it

**Record this as `SLACK_ANALYSIS_CHANNEL_ID`.**

Alternative if the panel does not show it: the channel URL in the browser ends with
the channel ID, for example `.../messages/C01ABCDEF23` means the ID is `C01ABCDEF23`.

## Step 9 - Report back

Reply with exactly this block, filled in:

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_ANALYSIS_CHANNEL_ID=C...
CHANNEL_NAME=#conversation-insights
CHANNEL_VISIBILITY=public
INTERACTIVITY_REQUEST_URL_SAVED=yes
NOTES=<anything that did not go as described, or "none">
```

## What you should NOT do

- Do not enable Event Subscriptions. This app does not use them.
- Do not add a slash command.
- Do not add any scope beyond the ones listed in Step 3.
- Do not rotate or regenerate any existing credential.
- Do not install the app to any workspace other than the one you were told to use.
