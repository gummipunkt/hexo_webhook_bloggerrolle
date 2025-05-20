/*
Important note:
This implementation only triggers the webhook for posts that have not been pinged since the last successful
save of the ping list. A file named `pinged_posts.json` is created
in the `scripts` folder of your Hexo blog and managed to keep track of this.

To configure the plugin:
1. Make sure this file (`webhook_ping.js`) is located in the `scripts/` folder.
2. Add the following line to your Hexo configuration file `_config.yml`
  and replace `YOUR_BLOG_URL_HERE` with the actual URL of your blog:
  webhook_ping_blog_url: 'YOUR_BLOG_URL_HERE'
*/ 
'use strict';

const https = require('https');
const querystring = require('querystring');
const fs = require('fs');
const path = require('path');

// Path to the file storing slugs of pinged posts
// It will be created in your hexo_project/scripts/ directory
const pingedPostsFilePath = path.join(hexo.script_dir, 'pinged_posts.json');

let previouslyPingedSlugs = new Set();
let newSlugsToPingThisSession = new Set();

// Load previously pinged slugs from the file when Hexo starts
try {
  if (fs.existsSync(pingedPostsFilePath)) {
    const data = fs.readFileSync(pingedPostsFilePath, 'utf8');
    const parsedData = JSON.parse(data);
    if (Array.isArray(parsedData)) {
      previouslyPingedSlugs = new Set(parsedData);
      hexo.log.info('Webhook Ping: Loaded previously pinged slugs from', pingedPostsFilePath);
    }
  } else {
    hexo.log.info('Webhook Ping: No pinged_posts.json found. Will create one after first pings.');
  }
} catch (err) {
  hexo.log.error('Webhook Ping: Error loading pinged_posts.json:', err);
}

// Register the hook that runs after each post is rendered
hexo.extend.filter.register('after_post_render', function(data) {
  const postSlug = data.slug;
  if (!postSlug) {
    hexo.log.warn('Webhook Ping: Post slug not found, skipping for:', data.path || data.source);
    return data;
  }

  const blogUrl = hexo.config.webhook_ping_blog_url;
  if (!blogUrl) {
    hexo.log.error("Webhook Ping: 'webhook_ping_blog_url' is not configured in _config.yml. Skipping webhook for post: " + postSlug);
    return data;
  }

  // Check if this post was already pinged in a previous session
  if (previouslyPingedSlugs.has(postSlug)) {
    hexo.log.info(`Webhook Ping: Post '${postSlug}' was already pinged. Skipping.`);
    return data;
  }

  // Check if this post is already scheduled for a ping in the current session (e.g. if filter runs multiple times for same post)
  if (newSlugsToPingThisSession.has(postSlug)) {
    hexo.log.info(`Webhook Ping: Post '${postSlug}' is already scheduled for ping in this session. Skipping duplicate.`);
    return data;
  }

  const webhookTargetUrl = `https://ping.bloggerrolle.de?blog=${postSlug}`;
  const postData = querystring.stringify({
    'url': blogUrl
  });

  const urlParts = new URL(webhookTargetUrl);

  const options = {
    hostname: urlParts.hostname,
    port: 443,
    path: `${urlParts.pathname}${urlParts.search}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  hexo.log.info(`Webhook Ping: Pinging for NEW post: '${postSlug}' to ${webhookTargetUrl}`);
  
  // Add to this session's ping list *before* making the request.
  // If the request fails, it won't be in previouslyPingedSlugs and will be retried next time.
  newSlugsToPingThisSession.add(postSlug);

  const req = https.request(options, (res) => {
    let responseBody = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      responseBody += chunk;
    });
    res.on('end', () => {
      hexo.log.info(`Webhook Ping: Response from ${webhookTargetUrl} [${res.statusCode}] for '${postSlug}': ${responseBody}`);
      // Note: We don't remove from newSlugsToPingThisSession on failure here.
      // If ping fails, it will be retried in the next generate cycle because it wouldn't have been added to previouslyPingedSlugs yet.
    });
  });

  req.on('error', (e) => {
    hexo.log.error(`Webhook Ping: Problem with request to ${webhookTargetUrl} for '${postSlug}': ${e.message}`);
    // If there was an error initiating the request, it might be good to remove it from the current session pings
    // so it doesn't get incorrectly saved as pinged if after_generate still runs.
    // However, for simplicity, if it fails here, it will be retried next time anyway as it won't be in previouslyPingedSlugs.
  });

  req.write(postData);
  req.end();

  return data;
});

// Register a hook to run after generation is complete to save the new pings
hexo.extend.hook.register('after_generate', async () => {
  if (newSlugsToPingThisSession.size > 0) {
    hexo.log.info(`Webhook Ping: Attempting to save ${newSlugsToPingThisSession.size} newly pinged slugs.`);
    newSlugsToPingThisSession.forEach(slug => previouslyPingedSlugs.add(slug));
    try {
      fs.writeFileSync(pingedPostsFilePath, JSON.stringify(Array.from(previouslyPingedSlugs)), 'utf8');
      hexo.log.info(`Webhook Ping: Successfully saved pinged slugs to ${pingedPostsFilePath}. Total distinct posts pinged: ${previouslyPingedSlugs.size}`);
      newSlugsToPingThisSession.clear(); // Reset for the next hexo generate run
    } catch (err) {
      hexo.log.error('Webhook Ping: Error saving pinged_posts.json:', err);
      hexo.log.warn('Webhook Ping: Slugs pinged in this session might be re-pinged next time due to save error.');
    }
  } else {
    hexo.log.info('Webhook Ping: No new posts were identified for pinging in this session.');
  }
});
