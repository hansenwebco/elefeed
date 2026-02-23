/**
 * @module demo
 * Sample data used when the app runs in demo mode (no server connection).
 */

export function getDemoHomePosts() {
  const now = Date.now();
  const t = (ms) => new Date(now - ms).toISOString();

  return [
    {
      id: '1', created_at: t(1000 * 60 * 3), in_reply_to_id: null, spoiler_text: '',
      reblog: null, sensitive: false, replies_count: 4, reblogs_count: 12, favourites_count: 87,
      url: '#', poll: null, media_attachments: [],
      _sourceTags: ['webdev', 'performance'],
      account: { id: 'a1', acct: 'talia@mastodon.social', display_name: 'Talia Voss', avatar: 'https://i.pravatar.cc/80?img=47', avatar_static: 'https://i.pravatar.cc/80?img=47', url: '#' },
      content: `<p>Just pushed a pretty big refactor of our rendering pipeline. Going from a pull-based to a push-based model cut latency by ~40% in our tests. Sometimes the boring architectural decisions are the most impactful ones. <a href="#" class="hashtag">#webdev</a> <a href="#" class="hashtag">#performance</a></p>`,
    },
    {
      id: 'h1', created_at: t(1000 * 60 * 5), spoiler_text: '', sensitive: false,
      reblog: null, replies_count: 2, reblogs_count: 8, favourites_count: 34,
      url: '#', poll: null, media_attachments: [],
      _sourceTags: ['webdev'],
      account: { id: 'ha1', acct: 'lena@fosstodon.org', display_name: 'Lena Brandt', avatar: 'https://i.pravatar.cc/80?img=16', avatar_static: 'https://i.pravatar.cc/80?img=16', url: '#' },
      content: `<p>TIL that the <code>:has()</code> CSS selector is now supported in all major browsers. The number of JS-dependent patterns this makes purely CSS is genuinely exciting. <a href="#" class="hashtag">#webdev</a> <a href="#" class="hashtag">#css</a></p>`,
    },
    {
      id: '2', created_at: t(1000 * 60 * 9), spoiler_text: '', sensitive: false,
      reblog: {
        id: '2r', created_at: t(1000 * 60 * 30), spoiler_text: '', sensitive: false,
        replies_count: 22, reblogs_count: 341, favourites_count: 1204,
        url: '#', poll: null, media_attachments: [],
        account: { id: 'a3', acct: 'mireille@fosstodon.org', display_name: 'Mireille Chen', avatar: 'https://i.pravatar.cc/80?img=5', avatar_static: 'https://i.pravatar.cc/80?img=5', url: '#' },
        content: `<p>The thing nobody tells you about open source is that the hardest part isn't writing the code—it's writing the docs clearly enough that someone at 2am in a timezone 12 hours from yours can figure it out without asking. That empathy muscle is the actual skill.</p>`,
      },
      replies_count: 0, reblogs_count: 0, favourites_count: 0, poll: null, media_attachments: [],
      _sourceTags: [],
      account: { id: 'a2', acct: 'joel@hachyderm.io', display_name: 'Joel Ramírez', avatar: 'https://i.pravatar.cc/80?img=12', avatar_static: 'https://i.pravatar.cc/80?img=12', url: '#' },
      url: '#', content: '',
    },
    {
      id: '3', created_at: t(1000 * 60 * 17), spoiler_text: '', sensitive: false,
      reblog: null, replies_count: 8, reblogs_count: 5, favourites_count: 66,
      url: '#', poll: null, media_attachments: [],
      _sourceTags: ['fediverse'],
      account: { id: 'a4', acct: 'priyanka@chaos.social', display_name: 'Priyanka S.', avatar: 'https://i.pravatar.cc/80?img=9', avatar_static: 'https://i.pravatar.cc/80?img=9', url: '#' },
      content: `<p>Trying to explain why I prefer Mastodon over other platforms and I keep coming back to: the people here seem to be *here* because they want to talk about things, not because they're optimizing for followers. It's a subtle but very real difference. <a href="#" class="hashtag">#fediverse</a></p>`,
    },
    {
      id: '4', created_at: t(1000 * 60 * 28), spoiler_text: 'mild rant about CSS grid', sensitive: false,
      reblog: null, replies_count: 14, reblogs_count: 9, favourites_count: 103,
      url: '#', poll: null, media_attachments: [],
      _sourceTags: [],
      account: { id: 'a5', acct: 'dex@infosec.exchange', display_name: 'Dex Fontaine', avatar: 'https://i.pravatar.cc/80?img=33', avatar_static: 'https://i.pravatar.cc/80?img=33', url: '#' },
      content: `<p>CSS grid is genuinely magic and I will die on this hill. Subgrid support finally landing everywhere means I can delete about 30% of my layout hacks. The number of "why won't this align" problems that just... disappear is not small.</p>`,
    },
    {
      id: '5', created_at: t(1000 * 60 * 45), spoiler_text: '', sensitive: false,
      reblog: null, replies_count: 3, reblogs_count: 18, favourites_count: 72,
      url: '#', _sourceTags: [],
      poll: {
        votes_count: 847,
        expired: false,
        options: [
          { title: 'Tabs', votes_count: 523 },
          { title: 'Spaces', votes_count: 289 },
          { title: 'I use a formatter, this is a non-issue', votes_count: 35 },
        ],
      },
      media_attachments: [],
      account: { id: 'a6', acct: 'sam@mastodon.online', display_name: 'Sam Okafor', avatar: 'https://i.pravatar.cc/80?img=51', avatar_static: 'https://i.pravatar.cc/80?img=51', url: '#' },
      content: `<p>The eternal question. Settle this for me:</p>`,
    },
    {
      id: '6', created_at: t(1000 * 60 * 62), spoiler_text: '', sensitive: false,
      reblog: null, replies_count: 6, reblogs_count: 24, favourites_count: 198,
      url: '#', poll: null, media_attachments: [],
      _sourceTags: [],
      account: { id: 'a7', acct: 'nevada@mastodon.social', display_name: 'Nevada Park', avatar: 'https://i.pravatar.cc/80?img=22', avatar_static: 'https://i.pravatar.cc/80?img=22', url: '#' },
      content: `<p>Reminder that "move fast and break things" was never good advice — it just happened to work for a narrow window when consumer internet was forgiving and the stakes were low. Both those things are very much no longer true. <a href="#" class="hashtag">#tech</a> <a href="#" class="hashtag">#engineering</a></p>`,
    },
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export function getDemoFollowingPosts() {
  return getDemoHomePosts().filter(p => !p.reblog);
}

export function getDemoHashtagData() {
  const tags = ['webdev', 'fediverse', 'opensource'];
  const now = Date.now();
  const t = (ms) => new Date(now - ms).toISOString();
  const posts = [
    {
      id: 'h1', created_at: t(1000 * 60 * 5), spoiler_text: '', sensitive: false,
      reblog: null, replies_count: 2, reblogs_count: 8, favourites_count: 34,
      url: '#', poll: null, media_attachments: [], _tag: 'webdev',
      account: { id: 'ha1', acct: 'lena@fosstodon.org', display_name: 'Lena Brandt', avatar: 'https://i.pravatar.cc/80?img=16', avatar_static: 'https://i.pravatar.cc/80?img=16', url: '#' },
      content: `<p>TIL that the <code>:has()</code> CSS selector is now supported in all major browsers. The number of JS-dependent patterns this makes purely CSS is genuinely exciting. <a href="#" class="hashtag">#webdev</a> <a href="#" class="hashtag">#css</a></p>`,
    },
    {
      id: 'h2', created_at: t(1000 * 60 * 22), spoiler_text: '', sensitive: false,
      reblog: null, replies_count: 11, reblogs_count: 31, favourites_count: 156,
      url: '#', poll: null, media_attachments: [], _tag: 'fediverse',
      account: { id: 'ha2', acct: 'orion@chaos.social', display_name: 'Orion Wells', avatar: 'https://i.pravatar.cc/80?img=60', avatar_static: 'https://i.pravatar.cc/80?img=60', url: '#' },
      content: `<p>The fediverse is doing something quietly remarkable: proving that decentralized social infrastructure can actually work at scale. Not perfectly, not without challenges — but it works, and it's growing. <a href="#" class="hashtag">#fediverse</a> <a href="#" class="hashtag">#activitypub</a></p>`,
    },
    {
      id: 'h3', created_at: t(1000 * 60 * 48), spoiler_text: '', sensitive: false,
      reblog: null, replies_count: 5, reblogs_count: 14, favourites_count: 89,
      url: '#', poll: null, media_attachments: [], _tag: 'opensource',
      account: { id: 'ha3', acct: 'piero@mastodon.social', display_name: 'Piero Gallo', avatar: 'https://i.pravatar.cc/80?img=39', avatar_static: 'https://i.pravatar.cc/80?img=39', url: '#' },
      content: `<p>Six years of maintaining this library and someone just opened a PR that rewrote the core algorithm in a way I'd never considered. It's faster, cleaner, and frankly I don't know why I didn't think of it. This is why I still love <a href="#" class="hashtag">#opensource</a>.</p>`,
    },
  ];
  return { tags, posts };
}
