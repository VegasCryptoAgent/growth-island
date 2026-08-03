export default [
{id:'ivy',k:'npc',z:'plaza',ox:-6,oy:-3,n:'Ivy',role:'The Profile Architect',c:'#0A66C2',tool:'audit',tip:KB.system,
 look:L('#F2D2B6','#4A3A6B','bun','#0A66C2','#FFC53D'),
 ask:[
  {q:'What if I have no results to show yet?',a:['Then document your own. Run the experiment on yourself and publish the numbers, including the ones that went badly.',
    'Building in public is real proof, and in six months it is the case study you did not have.']},
  {q:'How much of the profile actually matters?',a:['The headline and the first two lines of your About do most of the work, because that is all a visitor sees before deciding.',
    'Everything below that only matters to someone already leaning in. Profile, content and relationships form one system that turns attention into revenue.']},
  {q:'How long before this produces anything?',a:['Conversations start in weeks. Revenue usually lags a quarter behind, because people buy when their problem arrives, not when your post does.',
    'The archive is what closes them — they scroll back through six months of you before they ever send a message.']}],
 script:[{s:'You made it. Most people drift past this island for years without ever landing.'},
  {q:'Before I hand you anything — what are you actually here for?',o:[
   {say:'More followers. A bigger number.',r:[{s:'Honest. And wrong, but almost everyone starts there.'},
     {s:'The professional network — the Mainland, as we call it here — is the highest-leverage place for B2B visibility that converts into pipeline, not vanity metrics.'},
     {s:'A big number that never books a call is a very expensive hobby.'}]},
   {say:'Pipeline. I want this to produce revenue.',r:[{s:'Then you are already ahead of the harbour crowd.'},
     {s:'The professional network — the Mainland, as we call it here — is the highest-leverage place for B2B visibility that converts into pipeline, not vanity metrics.'}]},
   {say:'Honestly? No idea yet.',r:[{s:'Good. Uncertainty is cheaper than confidence in the wrong direction.'},
     {s:'Here is the frame: The professional network is the highest-leverage platform for B2B visibility that actually converts into sales and pipeline — not vanity metrics.'}]}]},
  {q:'Where do you think the work actually lives?',o:[
   {say:'In the posts.',r:[{s:'Partly. But a great post on a dead profile leaks everything it earns.'},
     {s:'Profile, content and relationships form one system that turns attention into revenue.'}]},
   {say:'In the relationships.',r:[{s:'Close. But relationships with no reason to start are just a list.'},
     {s:'Profile, content and relationships form one system that turns attention into revenue.'}]},
   {say:'All three, together.',r:[{s:'Yes. Say that back to yourself on the hard weeks.'},
     {s:'Profile, content and relationships form one system that turns attention into revenue.'}]}]},
  {s:'Then let us start where every visitor leaks the most. Open your profile — we are auditing it line by line.'}]},

{id:'puzzlehut',k:'spot',z:'plaza',ox:6,oy:-5,n:'The Puzzle Hut',role:'Daily puzzles',c:'#7C5CE0',glyph:'🧩',
 script:[{s:'Three puzzles a day, the same three for everybody on the island.'},
  {q:'Solve them and you will remember the lesson better than reading it. Have a go?',o:[
   {say:'What are they?',r:[{s:'The Thread \u2014 five clues, name what connects them.'},
     {s:'The Grid \u2014 one signal per day, per pillar, never touching.'},
     {s:'The Ladder \u2014 put a real workflow back in the right order.'}]},
   {say:'Deal me in.',r:[{s:'New set every midnight. Scores go on your record.'}]}]}]},

{id:'sign',k:'spot',z:'plaza',ox:-1,oy:5,n:'Island Signpost',role:'Weathered oak',c:'#F5A623',tip:KB.views,glyph:'🗺️',
 script:[{s:'West: Feed District and the Signal Tower. North: Comment Grove. East: Algorithm Forest.'},
  {s:'South: Pipeline Pier. Past the forest: Authority Peak. Southwest of the Feed: the AI Workshop.'},
  {q:'Carved at the base, half worn away: "What are we all actually chasing?"',o:[
   {say:'Reach.',r:[{s:'Underneath, in smaller letters: the goal is millions of intelligent human views that lead to real business outcomes.'},
     {s:'Reach is only the first half of that sentence.'}]},
   {say:'Outcomes.',r:[{s:'The carving agrees: the goal is millions of intelligent human views that lead to real business outcomes.'}]}]}]},

{id:'s_proof',k:'spot',z:'plaza',ox:4,oy:3,n:'The Proof Stone',role:'Humming granite',c:'#7C5CE0',award:'proof',tool:'proof',glyph:'🛡️',
 script:[{s:'The stone hums. Inside it, a shield assembled entirely from screenshots.'},
  {q:'A voice from the rock: "What convinces a stranger fastest?"',o:[
   {say:'A confident claim.',r:[{s:'"No. Everyone has one of those."'},
     {s:'"Show the outcome. Content has to stop the scroll, deliver value and proof, and end in a clear path toward a conversation."'}]},
   {say:'The receipt. The actual result.',r:[{s:'"Correct. The artefact does the persuading."'},
     {s:'"Stop the scroll, deliver value and proof, end in a clear path toward a conversation or a conversion."'}]}]},
  {s:'"Bring me a vague claim and I will forge it into a proof post."'}]},

{id:'dax',k:'npc',z:'feed',ox:-6,oy:-4,n:'Dax',role:'The Drafter',c:'#1BA8DC',tool:'forge',tip:KB.shape,
 look:L('#D9A97E','#2F3E52','crop','#1BA8DC','#FFFFFF'),
 ask:[
  {q:'How do I find the hook when nothing feels interesting?',a:['Write the whole post first, badly. Then read it back and find the one sentence you would say out loud to a friend.',
    'That sentence is the hook. Delete whatever you had at the top and put it there.']},
  {q:'Should I use a hook I have used before?',a:['Yes. A format is not a repeat — a new reader is seeing it for the first time, and your regulars recognise the shape and stay.',
    'Keep your top twenty openers in a file and rotate them by intent.']},
  {q:'How long should a post be?',a:['Long enough to deliver the proof and short enough that nothing in it is filler. Most posts die from padding, not brevity.',
    'Content has to stop the scroll, deliver value and proof, and end in a clear path toward a conversation or a conversion.']}],
 script:[{s:'Everyone in this district writes. Almost nobody gets read.'},
  {q:'Read me your opener. Which is closest to how you usually start?',o:[
   {say:'"In today\u2019s fast-paced business world…"',r:[{s:'Stop. That sentence has never once earned a second line.'},
     {s:'Mobile truncates near two hundred characters. You just spent them clearing your throat.'},
     {s:'Content has to stop the scroll, deliver value and proof, and end in a clear path toward a conversation or a conversion.'}]},
   {say:'"We cut onboarding from 21 days to 4."',r:[{s:'There it is. A number and an implied problem in nine words.'},
     {s:'Now finish it: deliver the proof in the middle, then a clear path toward a conversation or a conversion.'}]},
   {say:'I start typing and see what happens.',r:[{s:'Then write the post first and move its sharpest sentence to the top. That is your hook.'},
     {s:'Content has to stop the scroll, deliver value and proof, and end in a clear path toward a conversation or a conversion.'}]}]},
  {s:'Sit at the bench. We are going to forge you a real hook out of parts.'}]},

{id:'tower',k:'spot',z:'feed',ox:1,oy:-7,n:'The Signal Tower',role:'Daily leaderboard',c:'#FFC53D',tool:'tower',glyph:'📶',
 script:[{s:'A lattice of steel hums above the boulevard. Every hook published on this island passes through it.'},
  {s:'It scores what you write, ranks it against everyone playing today, and the top five percent gets real engagement from Cory Warfield.'},
  {s:'Write the line you are actually going to publish.'}]},

{id:'g_scroll',k:'npc',z:'feed',ox:-7,oy:5,n:'Rell',role:'Feed Warden',c:'#F5A623',game:'feed',
 look:L('#C98F63','#22304A','cap','#F5A623','#123253'),
 script:[{s:'Everyone says “my audience” like it is one person. Come and meet them.'},
  {q:'Five readers, five different needs, and one post to warm them all. Ready?',o:[
   {say:'Deal me in.',r:[{s:'Watch the patience meters. Nobody in a feed waits forever.'}]},
   {say:'How do I know what each one wants?',r:[{s:'You learn it by losing them. The sceptic wants receipts. The lurker wants a person.'},
     {s:'Content has to stop the scroll, deliver value and proof, and end in a clear path toward a conversation or a conversion.'}]}]}]},

{id:'g_rally',k:'npc',z:'grove',ox:-6,oy:6,n:'Bo',role:'Comment Coach',c:'#1E9E52',tool:'comment',tip:KB.engage,
 look:L('#7E5136','#141C24','crop','#1E9E52','#FFF8EC'),
 script:[{s:'Most comments are applause. Applause dies. The ones that add a number, a counter-case or a real question get replies.'},
  {q:'Want the Comment Lab, or a daily Thread puzzle later?',o:[
   {say:'Open the Comment Lab.',r:[{s:'Good. Write like you are helping one real person, not performing for a room.'}]},
   {say:'I will take the puzzles.',puzzle:'thread',r:[{s:'Press the Puzzles button any time. The Thread teaches the same lesson without a timer.'}]}]}]},

{id:'g_surf',k:'npc',z:'pier',ox:-8,oy:4,n:'Marn',role:'Pipeline Keeper',c:'#EF7A18',tool:'cta',tip:KB.leverage,
 look:L('#E7BE97','#7A4A24','wave','#EF7A18','#123253'),
 script:[{s:'Impressions do not pay rent. Conversations do. Every post needs a next step a real person can take.'},
  {q:'Want help writing a closer?',o:[
   {say:'Help me close.',r:[{s:'One soft ask. No calendar link on a cold room. Conversation first.'}]},
   {say:'I will climb the Ladder puzzle.',puzzle:'ladder',r:[{s:'Put the steps back in order. That is the pipeline, not a slogan.'}]}]}]},

{id:'g_arch',k:'npc',z:'peak',ox:-9,oy:4,n:'Ines',role:'Proof Ranger',c:'#E8479B',tool:'voice',tip:KB.shape,
 look:L('#BE8358','#2C2334','pony','#E8479B','#FFF8EC'),
 script:[{s:'Claims without receipts die in the wind. A stranger should be able to check what you said without trusting you first.'},
  {q:'Want the Voice Finder?',o:[
   {say:'Find my voice.',r:[{s:'First person. Something real. Something a peer would forward.'}]},
   {say:'I will play The Grid.',puzzle:'grid',r:[{s:'One signal per day, per pillar, none touching. Spread the idea — do not dump it.'}]}]}]},

{id:'g_climb',k:'npc',z:'lab',ox:6,oy:-5,n:'Wynn',role:'Cadence Smith',c:'#E8453C',tool:'cadence',tip:KB.system,
 look:L('#EDCEAF','#3E2A1A','bun','#E8453C','#FFC53D'),
 script:[{s:'The wall is not the hard part. Holding a cadence you can keep on your worst week is.'},
  {q:'Cadence plan, or The Feed with Rell?',o:[
   {say:'Build my week.',r:[{s:'Vary format, length and hour. Find YOUR window — nobody has the same one.'}]},
   {say:'Send me to The Feed.',game:'feed',r:[{s:'Rell runs it in Feed District. That is the real game on this island.'}]}]}]},

{id:'b_ghost',k:'foe',z:'feed',ox:3,oy:0,n:'Ghost Poster',role:'Blocker',c:'#8FA6BE',award:'hook',glyph:'👻',
 foe:{hp:96,atk:15,moves:['Post and Vanish','Cold Silence','Ignored Reply']},
 script:[{s:'A pale shape drifts up out of the feed. "I posted once. Then I closed the app for nine days."'},
  {q:'"Nobody replied. Nobody ever replies." It waits.',o:[
   {say:'Because you left. Publishing is half the job.',r:[{s:'It flinches. "…Half?" The air goes cold. It will not let you pass.'}]},
   {say:'Say nothing. Draw your Signal.',r:[{s:'It takes your silence as agreement and lunges.'}]}]}]},

{id:'nia',k:'npc',z:'grove',ox:-7,oy:0,n:'Nia',role:'Keeper of the Grove',c:'#1E9E52',tool:'comment',tip:KB.engage,
 look:L('#8A5A3C','#241C2E','braid','#1E9E52','#FFC53D'),
 ask:[
  {q:'Whose posts should I actually comment on?',a:['People your buyers already read. Not your competitors, not other people selling what you sell.',
    'Make a list of thirty and work it. Ten thoughtful comments a day beats a hundred scattered ones.']},
  {q:'What if I disagree with the post?',a:['Then say so, generously, with a number attached. A polite disagreement carrying evidence is the highest-reach comment on the platform.',
    'It hands the author something to answer, and their whole audience watches the exchange.']},
  {q:'Does commenting really beat posting?',a:['In month one, yes — you are borrowing audiences instead of building one from zero.',
    'By month six you want both. High-effort engagement is a major growth lever, not a replacement for having something to say.']}],
 script:[{s:'Every tree here grew out of somebody else\u2019s post. That whole canopy is comments.'},
  {q:'A post from someone your buyers read went up four minutes ago. What do you do?',o:[
   {say:'Like it and move on.',r:[{s:'Then you were never there.'},
     {s:'High-effort engagement — especially thoughtful comments — is a major growth lever. A like is a shrug.'}]},
   {say:'Leave three real sentences with an angle they missed.',r:[{s:'That is the whole trick, and almost nobody does it.'},
     {s:'High-effort engagement — especially thoughtful comments — is a major growth lever.'},
     {s:'Their readers click the profile of whoever taught them something. That is reach, borrowed and free.'}]},
   {say:'Drop my link in the comments.',r:[{s:'And you will be scrolled past and quietly muted.'},
     {s:'High-effort engagement — especially thoughtful comments — is a major growth lever. Give first.'}]}]},
  {s:'Come to the clearing. I have three real posts and I want to see what you would actually write under them.'}]},

{id:'b_lurk',k:'foe',z:'grove',ox:6,oy:3,n:'Lurker Shade',role:'Blocker',c:'#7C8FA3',award:'comment',glyph:'🫥',
 foe:{hp:108,atk:17,moves:['Silent Scroll','Fade Out','Passive Drift']},
 script:[{s:'Something half-visible steps out of the canopy. "I have read everything you wrote. I have never said a word."'},
  {q:'"I am the reason your reach is flat." Do you answer it?',o:[
   {say:'You are also the reason it could triple.',r:[{s:'It shimmers, almost solid. "…Say more." Then it attacks anyway.'}]},
   {say:'Then stop lurking and let\u2019s go.',r:[{s:'The shade grins and drops its camouflage.'}]}]}]},

{id:'orin',k:'npc',z:'forest',ox:-8,oy:-5,n:'Orin',role:'The Contrarian',c:'#7C5CE0',tool:'voice',tip:KB.voice,
 look:L('#EFD3B4','#B9BFCC','wave','#7C5CE0','#FFC53D'),
 ask:[
  {q:'What if my opinion annoys a potential client?',a:['Then they were not your client. A position some readers reject is exactly what makes the rest stay.',
    'The people who agree with you loudly are the ones who send DMs.']},
  {q:'How do I find my angle if I am not contrarian by nature?',a:['You do not have to be rude, only specific. Say precisely what you have seen and be willing to be wrong in public.',
    'Specificity reads as a voice even when it is not aggressive.']},
  {q:'Where is the line with satire?',a:['Mock the practice, never the person. Then rebuild it into a better standard in the same post.',
    'Satire that only tears down reads as bitterness. Satire that rebuilds reads as leadership.']}],
 script:[{s:'This forest eats agreeable people. It cannot digest a voice.'},
  {q:'Say something your industry believes that you think is wrong.',o:[
   {say:'I would rather not upset anyone.',r:[{s:'Then you will be forgotten by everyone, very politely.'},
     {s:'A unique voice, and the occasional sharp or satirical edge, is how you cut through the noise.'}]},
   {say:'Most of it is theatre and everyone knows it.',r:[{s:'Now the trees are listening. Name the specific absurdity, then rebuild it into a better standard.'},
     {s:'A unique voice, and the occasional sharp or satirical edge, is how you cut through the noise.'}]},
   {say:'Everyone posts advice nobody has tested.',r:[{s:'Sharp. Say it publicly with your name on it and watch who arrives.'},
     {s:'A unique voice, and the occasional sharp or satirical edge, is how you cut through the noise.'}]}]},
  {s:'Sit. We are going to find the three positions only you can defend.'}]},

{id:'b_vamp',k:'foe',z:'forest',ox:7,oy:4,n:'Vanity Vampire',role:'Blocker',c:'#E8455F',award:'satire',glyph:'🧛',
 foe:{hp:118,atk:19,moves:['Like Drain','Empty Virality','Follower Illusion']},
 script:[{s:'"Two hundred thousand impressions," it purrs, "and zero conversations. I feel wonderful."'},
  {q:'It offers you a cup of numbers. Do you drink?',o:[
   {say:'Not unless one of them booked a call.',r:[{s:'The cup shatters. It hisses and comes at you.'}]},
   {say:'…That is a very big number, though.',r:[{s:'"It is, isn\u2019t it." Your Signal shoves you back before you take the cup.'}]}]}]},

{id:'sol',k:'npc',z:'pier',ox:-9,oy:-3,n:'Sol',role:'Harbourmaster',c:'#F5A623',tool:'cta',tip:KB.shape,
 look:L('#B87A50','#2B2B33','cap','#F5A623','#123253'),
 ask:[
  {q:'How often should I put a CTA on a post?',a:['Roughly every third post. Any more and the feed reads you as a billboard.',
    'The other two build the credit you are spending when you finally ask.']},
  {q:'Comment CTA or DM CTA?',a:['Comment, almost always. It is a lower ask, it keeps the thread alive, and it hands you a public list of people who raised a hand.',
    'Then you move to DMs having already given them something.']},
  {q:'Nobody responds to my CTAs. Why?',a:['Usually because the post before it did not earn anything. A CTA is a withdrawal from an account you have to fund first.',
    'Check whether the post delivered proof, or just an opinion with an ask stapled to the end.']}],
 script:[{s:'Boats leave this pier loaded with attention. Most come back empty.'},
  {q:'Your post did well. Two thousand views. What next step did you give them?',o:[
   {say:'There wasn\u2019t one.',r:[{s:'Then you rented a stage and walked off it.'},
     {s:'Content has to stop the scroll, deliver value and proof, and end in a clear path toward a conversation or a conversion.'}]},
   {say:'"Comment TEMPLATE and I\u2019ll send it."',r:[{s:'One word, no link, no friction, and it keeps the thread alive. That is the good version.'},
     {s:'Content has to end in a clear path toward a conversation or a conversion.'}]},
   {say:'A link to book a sixty-minute call.',r:[{s:'From a stranger? You asked for a marriage on a first glance.'},
     {s:'Shrink the ask. A conversation first, then a conversion.'}]}]},
  {s:'Step into the harbour office. We will build the closing line for whatever you publish next.'}]},

{id:'exchange',k:'spot',z:'pier',ox:7,oy:-6,n:'The Exchange',role:'Trading house',c:'#1B9E4B',tool:'market',glyph:'🏪',
 script:[{s:'A low building with a wide shelf and a queue outside it. Somebody is always unloading crates.'},
  {q:'The keeper looks up. "Buying, or selling?"',o:[
   {say:'Buying. What is worth paying for?',r:[{s:'"Cory keeps his own shelf here. The four-hour masterclass, and the AI readiness workshop."'},
     {s:'"Island prices. He does not run them anywhere else."'}]},
   {say:'Selling. I have an offer.',r:[{s:'"Then put it on the shelf. We take twenty percent of whatever it earns, and nothing if it earns nothing."'},
     {s:'"Everything gets read before it goes up. Vague offers do not make it."'}]}]}]},

{id:'b_ghoul',k:'foe',z:'pier',ox:7,oy:3,n:'Cold Outreach Ghoul',role:'Blocker',c:'#2AA8E8',award:'pipeline',glyph:'📨',
 foe:{hp:126,atk:20,moves:['Template Blast','Merge Field Error','Follow-Up Spam']},
 script:[{s:'"Hi {FirstName}, I noticed you breathe oxygen. Quick fifteen minutes?"'},
  {q:'It has sent that four thousand times today. It offers you the template.',o:[
   {say:'Keep it. I\u2019ll send ten that mean something.',r:[{s:'"Ten?" It laughs, genuinely baffled, and attacks.'}]},
   {say:'Does it work?',r:[{s:'"Define work." The planks creak. It is done talking.'}]}]}]},

{id:'kip',k:'npc',z:'lab',ox:-6,oy:-3,n:'Kip',role:'Workshop Keeper',c:'#E8453C',tool:'cadence',tip:KB.ai,
 look:L('#F1D5BA','#D2703A','crop','#E8453C','#123253'),
 ask:[
  {q:'Which parts should I never hand over?',a:['The story, the client detail, and the opinion with your name on it. Those are the only things nobody else can generate.',
    'Everything else — outlines, format variants, repurposing, editing — is fair game.']},
  {q:'How do I stop AI output sounding like everyone else?',a:['Feed it your ten best posts and ask it to write down your voice rules. Keep that description and reuse it as a system prompt.',
    'Then always do the last edit yourself, out loud.']},
  {q:'What cadence should I actually aim for?',a:['The one you can hold on your worst week, not your best. Three a week you keep beats seven you abandon in month two.',
    'Consistency plus AI leverage is how solo creators scale.']}],
 script:[{s:'One person used to be a hard ceiling. Not any more.'},
  {q:'What would you hand the machine?',o:[
   {say:'Everything. Let it write the posts.',r:[{s:'Then you will publish the same post as everyone else who did that.'},
     {s:'Consistency plus AI leverage — Claude, Grok, NotebookLM — is how solo creators scale. Leverage, not replacement.'},
     {s:'Keep the story, the client detail, and the opinion with your name on it.'}]},
   {say:'Outlining, editing, repurposing. Not the opinions.',r:[{s:'That is exactly the line, and you found it without me.'},
     {s:'Consistency plus AI leverage — Claude, Grok, NotebookLM — is how solo creators scale.'}]},
   {say:'Nothing. It all sounds fake.',r:[{s:'Then you will be out-shipped by someone with half your taste and twice your cadence.'},
     {s:'Consistency plus AI leverage — Claude, Grok, NotebookLM — is how solo creators scale.'}]}]},
  {s:'Take the bench. We are building a cadence you can actually hold on a bad week.'}]},

{id:'s_ai',k:'spot',z:'lab',ox:5,oy:2,n:'The Amplifier Coil',role:'Crackling apparatus',c:'#E8453C',award:'ai',glyph:'⚡',
 script:[{s:'The coil throws sparks in the shape of a full content calendar.'},
  {s:'It does not write for you. It removes the reason you stopped writing.'}]},

{id:'vera',k:'npc',z:'peak',ox:-7,oy:-3,n:'Vera',role:'Keeper of the Peak',c:'#E8479B',tool:'dm',tip:KB.moat,
 look:L('#E9C4A2','#5B2E5E','pony','#E8479B','#FFC53D'),
 ask:[
  {q:'Newsletter on the network or my own list?',a:['Both, in that order. Launch on the network for the notification blast it sends to your followers, then mirror every issue to a list you own.',
    'One gets you reach you do not control. The other gets you an audience nobody can take away.']},
  {q:'What do I write in it that is not already a post?',a:['Depth. The piece someone forwards internally to the person holding the budget is almost never a nine-hundred-character post.',
    'One substantial piece a week beats daily fragments for buyers.']},
  {q:'How do I get the first hundred subscribers?',a:['Ask, in the posts that already work. Not a link — one word in the comments, then you send it.',
    'Newsletters and owned assets create long-term moats, and the moat starts at one.']}],
 script:[{s:'The wind up here changes every season. Nothing built on rented ground survives it.'},
  {q:'You have forty thousand followers and the feed goes quiet tomorrow. What do you still have?',o:[
   {say:'Forty thousand followers.',r:[{s:'You have forty thousand strangers you can no longer reach.'},
     {s:'Newsletters and owned assets create long-term moats. Followers are rented. Subscribers are owned.'}]},
   {say:'My newsletter list.',r:[{s:'Then the weather stops mattering to you.'},
     {s:'Newsletters and owned assets create long-term moats.'}]},
   {say:'Nothing, honestly.',r:[{s:'Most people\u2019s honest answer. Fix it this quarter, not next year.'},
     {s:'Newsletters and owned assets create long-term moats.'}]}]},
  {s:'One more thing before the summit. Nobody owns an audience they never speak to directly. Let us write one real message.'}]},

{id:'b_algo',k:'foe',z:'peak',ox:6,oy:3,n:'Algorithm Update',role:'Final Blocker',c:'#8B5CF6',award:'ranger',final:true,glyph:'🗿',
 foe:{hp:118,atk:22,moves:['Reach Reshuffle','Format Downrank','Distribution Squeeze']},
 script:[{s:'The summit stone opens one eye. "Everything that worked last quarter is downranked."'},
  {q:'"Adapt, or vanish." What survives me?',o:[
   {say:'A point of view, real proof, and actual conversations.',r:[
     {s:'The stone is quiet a long moment. "…Those, I cannot downrank." It attacks anyway. It has to.'}]},
   {say:'Nothing survives you.',r:[{s:'"Correct," it says, almost kindly, and raises the summit against you.'}]}]}]}
];
