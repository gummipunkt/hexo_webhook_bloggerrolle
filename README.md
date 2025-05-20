This implementation only triggers the webhook for posts that have not been pinged since the last successful
save of the ping list. A file named `pinged_posts.json` is created
in the `scripts` folder of your Hexo blog and managed to keep track of this.

To configure the plugin:
1. Make sure this file (`webhook_ping.js`) is located in the `scripts/` folder.
2. Add the following line to your Hexo configuration file `_config.yml`
  and replace `YOUR_BLOG_URL_HERE` with the actual URL of your blog:
  webhook_ping_blog_url: 'YOUR_BLOG_URL_HERE'
