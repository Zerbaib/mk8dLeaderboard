const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, Events, PermissionFlagsBits, MessageFlags, ActivityType,
  SlashCommandBuilder,
} = require('discord.js');
const store = require('./db');
const webhook = require('./webhook');
const { COUNTRY_BY_CODE, REGION_BY_ID } = require('./countries');

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const MOD_ROLE_ID = process.env.DISCORD_MOD_ROLE_ID; // optional
// Bot status (custom status shown under the bot's name)
const BOT_STATUS = process.env.DISCORD_BOT_STATUS || '🚀 go on mk8dxtimes.com';
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
// Roles given automatically (optional): verified account, current record holder, former record holder, top 10
const ROLE_IDS = {
  verified: process.env.DISCORD_VERIFIED_ROLE_ID,
  wr: process.env.DISCORD_WR_ROLE_ID,
  formerWr: process.env.DISCORD_FORMER_WR_ROLE_ID,
  top10: process.env.DISCORD_TOP10_ROLE_ID,
};
const ROLE_LABELS = { verified: 'Verified', wr: 'WR holder', formerWr: 'Former WR', top10: 'Top 10' };
const ROLE_SYNC_HOURS = Number(process.env.ROLE_SYNC_HOURS || 48);
const rolesEnabled = () => Object.values(ROLE_IDS).some(Boolean);
let membersIntent = false;
const MAX_ATTACH = 8 * 1024 * 1024; // above this size we send a link instead of the file

const COLORS = { pending: 0xf5b301, approved: 0x2ecc71, rejected: 0xe74c3c };
const LABELS = { pending: '⏳ Pending review', approved: '✅ Approved', rejected: '❌ Rejected' };

let client = null;
let ready = false;

const flag = (code) => (code && code.length === 2
  ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '');

function proofLink(sub) {
  if (sub.proof_url) return sub.proof_url;
  if (sub.proof_file) return `${PUBLIC_URL}/uploads/${sub.proof_file}`;
  return null;
}

function buildEmbed(sub) {
  const track = store.TRACK_BY_ID[sub.track_id];
  const country = COUNTRY_BY_CODE[sub.country];
  const embed = new EmbedBuilder()
    .setTitle(`🏁 ${track ? track.name : sub.track_id} — ${sub.cc}cc`)
    .setColor(COLORS[sub.status])
    .addFields(
      { name: 'Player', value: sub.player_name, inline: true },
      { name: 'Time', value: `**${store.formatTime(sub.time_ms)}**`, inline: true },
      { name: 'Class', value: `${sub.cc}cc`, inline: true },
      { name: 'Country', value: `${flag(sub.country)} ${country ? country.name : sub.country}`, inline: true },
      { name: 'Region', value: REGION_BY_ID[country?.region]?.name || '—', inline: true },
      { name: 'Cup', value: track ? track.cup : '—', inline: true },
    )
    .setFooter({ text: `Submission #${sub.id} • ${LABELS[sub.status]}` })
    .setTimestamp(new Date(`${sub.created_at}Z`));

  if (sub.discord_id) {
    embed.addFields({ name: 'Discord account (verified)', value: `<@${sub.discord_id}> (${sub.discord_name || 'unknown'})` });
  }
  const link = proofLink(sub);
  if (link) embed.addFields({ name: 'Proof', value: link });
  if (sub.comment) embed.addFields({ name: 'Comment', value: sub.comment.slice(0, 1000) });
  if (sub.status !== 'pending') {
    embed.addFields({ name: 'Reviewed by', value: sub.reviewed_by || '—', inline: true });
  }
  if (sub.status === 'rejected' && sub.reject_reason) {
    embed.addFields({ name: 'Rejection reason', value: sub.reject_reason.slice(0, 1000) });
  }
  if (sub.proof_file && /\.(png|jpe?g|gif|webp)$/i.test(sub.proof_file)) {
    embed.setImage(`attachment://${sub.proof_file}`);
  }
  return embed;
}

function buildButtons(sub, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mk8:approve:${sub.id}`).setLabel('Approve').setEmoji('✅')
      .setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`mk8:reject:${sub.id}`).setLabel('Reject').setEmoji('❌')
      .setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

// Sends a direct message to a player; returns false if their DMs are closed
async function dm(discordId, content) {
  if (!ready || !discordId) return false;
  try {
    const user = await client.users.fetch(discordId);
    await user.send(content);
    return true;
  } catch {
    return false;
  }
}

// Tells the top 10 players overtaken (or tied) by a new time
function notifyOvertaken(sub, ranking) {
  const track = store.TRACK_BY_ID[sub.track_id];
  const where = `**${track ? track.name : sub.track_id} ${sub.cc}cc**`;
  const by = `**${sub.player_name}** ${flag(sub.country)}`;
  const time = store.formatTime(sub.time_ms);
  const link = `${PUBLIC_URL}/track/${sub.track_id}/${sub.cc}cc`;
  for (const e of ranking.passed) {
    if (!e.discord_id || e.discord_id === sub.discord_id) continue;
    const gap = ((e.time_ms - sub.time_ms) / 1000).toFixed(3);
    let text;
    if (e.oldRank === 1) {
      text = `⚠️ Your record on ${where} (${store.formatTime(e.time_ms)}) was beaten by ${by} with **${time}** (−${gap} s). Time to take it back!`;
    } else if (e.newRank > store.TOP) {
      text = `📉 ${by} passed you on ${where} with **${time}**: you dropped out of the top ${store.TOP} (now #${e.newRank}).`;
    } else {
      text = `📉 ${by} passed you on ${where} with **${time}** (−${gap} s): you're now **#${e.newRank}** (was #${e.oldRank}).`;
    }
    dm(e.discord_id, `${text} ${link}`);
  }
  for (const e of ranking.tiedWith) {
    if (!e.discord_id || e.discord_id === sub.discord_id) continue;
    dm(e.discord_id, ranking.rank === 1
      ? `🤝 ${by} tied your record on ${where} (${time}). Time to break the tie! ${link}`
      : `🤝 ${by} tied your time on ${where} (${time}): you now share #${ranking.rank}. ${link}`);
  }
}

// Confirms to the player that their verified submission is waiting for a moderator
function notifyPending(sub) {
  return dm(sub.discord_id, `⏳ Your time on **${trackLabel(sub)}** is verified and waiting for a moderator. `
    + "You'll get a DM as soon as it's reviewed.");
}

function trackLabel(sub) {
  const track = store.TRACK_BY_ID[sub.track_id];
  return `${track ? track.name : sub.track_id} ${sub.cc}cc (${store.formatTime(sub.time_ms)})`;
}

async function notifySubmission(sub) {
  if (!ready) {
    console.warn(`[discord] Bot not connected: submission #${sub.id} stays pending.`);
    return;
  }
  const channel = await client.channels.fetch(CHANNEL_ID);
  const payload = { embeds: [buildEmbed(sub)], components: [buildButtons(sub)], files: [] };

  if (sub.proof_file) {
    const filePath = path.join(UPLOAD_DIR, sub.proof_file);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size <= MAX_ATTACH) {
      payload.files.push(new AttachmentBuilder(filePath, { name: sub.proof_file }));
    } else {
      payload.embeds[0].setImage(null);
    }
  }
  const message = await channel.send(payload);
  store.setDiscordMessage(sub.id, message.id);
}

function canModerate(interaction) {
  if (MOD_ROLE_ID) return interaction.member?.roles?.cache?.has(MOD_ROLE_ID);
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
}

async function refreshMessage(interaction, sub) {
  const embed = buildEmbed(sub);
  // Keep the attachment already on the message
  if (!interaction.message.attachments.size) embed.setImage(null);
  await interaction.update({ embeds: [embed], components: [] });
}

async function handleInteraction(interaction) {
  if (interaction.isChatInputCommand()) {
    await handleCommand(interaction);
    return;
  }
  const id = interaction.customId || '';
  if (!id.startsWith('mk8:')) return;
  const [, action, rawId] = id.split(':');
  const subId = Number(rawId);

  if (!canModerate(interaction)) {
    await interaction.reply({ content: '⛔ You are not allowed to review submissions.', flags: MessageFlags.Ephemeral });
    return;
  }

  const reviewer = interaction.user.globalName || interaction.user.username;

  if (interaction.isButton() && action === 'approve') {
    let result;
    try {
      result = store.approveSubmission(subId, reviewer);
    } catch (e) {
      await interaction.reply({ content: `⚠️ ${e.message}`, flags: MessageFlags.Ephemeral });
      return;
    }
    const { sub, changed, ranking } = result;
    if (!changed) {
      await interaction.reply({ content: `This submission has already been reviewed (${LABELS[sub.status]}).`, flags: MessageFlags.Ephemeral });
      return;
    }
    await refreshMessage(interaction, sub);
    // A time entering the top 10 is announced, and the players it overtakes are notified
    if (ranking) webhook.announceRecord(sub, ranking);
    let extra = '';
    if (ranking?.rank === 1) extra = ranking.tiedWith.length ? ' 🤝 **You tied the record!**' : ' 🏆 **It is the new record!**';
    else if (ranking) extra = ` 🔥 **You're now #${ranking.rank} on this track!**`;
    dm(sub.discord_id, `✅ Your time on **${trackLabel(sub)}** has been approved and is now on the leaderboard!${extra} `
      + `${PUBLIC_URL}/track/${sub.track_id}/${sub.cc}cc`);
    if (ranking) notifyOvertaken(sub, ranking);
    return;
  }

  if (interaction.isButton() && action === 'reject') {
    const sub = store.getSubmission(subId);
    if (!sub || sub.status !== 'pending') {
      await interaction.reply({ content: 'This submission has already been reviewed.', flags: MessageFlags.Ephemeral });
      return;
    }
    const modal = new ModalBuilder().setCustomId(`mk8:rejectmodal:${subId}`).setTitle(`Reject submission #${subId}`)
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('reason').setLabel('Rejection reason (optional)')
          .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500),
      ));
    await interaction.showModal(modal);
    return;
  }

  if (interaction.isModalSubmit() && action === 'rejectmodal') {
    const reason = interaction.fields.getTextInputValue('reason')?.trim();
    const { sub, changed } = store.rejectSubmission(subId, reviewer, reason);
    if (!changed) {
      await interaction.reply({ content: 'This submission has already been reviewed.', flags: MessageFlags.Ephemeral });
      return;
    }
    await refreshMessage(interaction, sub);
    dm(sub.discord_id, `❌ Your time on **${trackLabel(sub)}** was rejected.${sub.reject_reason ? `\nReason: ${sub.reject_reason}` : ''}`);
  }
}

// ---------- Slash commands ----------
const ROLE_CHOICES = Object.entries(ROLE_LABELS).map(([value, name]) => ({ name, value }));
// Admin commands: members with "Manage Roles" (or the admins of the site)
const canManageRoles = (interaction) => interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)
  || String(process.env.ADMIN_DISCORD_IDS || '').split(/[\s,]+/).includes(interaction.user.id);

const COMMANDS = [
  new SlashCommandBuilder().setName('verif')
    .setDescription('Get a 6-digit code by DM to verify your time submission on the website'),
  new SlashCommandBuilder().setName('sync-roles')
    .setDescription('Moderators: update the leaderboard roles (WR, former WR, top 10, verified) now')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder().setName('manual-role')
    .setDescription('Admins: give a leaderboard role by hand (kept by the automatic sync)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((c) => c.setName('add').setDescription('Give a role by hand (never removed by the sync)')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('role').setDescription('Role').setRequired(true).addChoices(...ROLE_CHOICES)))
    .addSubcommand((c) => c.setName('remove').setDescription('Remove a role given by hand (the sync decides again)')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('role').setDescription('Role').setRequired(true).addChoices(...ROLE_CHOICES)))
    .addSubcommand((c) => c.setName('list').setDescription('List the roles given by hand')),
  new SlashCommandBuilder().setName('link')
    .setDescription('Moderators: link a player name to a Discord account')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption((o) => o.setName('player').setDescription('Player name on the leaderboard').setRequired(true))
    .addUserOption((o) => o.setName('user').setDescription('Discord account').setRequired(true)),
];

async function handleCommand(interaction) {
  const ephemeral = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  if (interaction.commandName === 'verif') {
    const { user } = interaction;
    const result = store.issueCode(user.id, user.username);
    if (result.cooldown) {
      await ephemeral(`⏳ Please wait ${result.cooldown} s before asking for a new code.`);
      return;
    }
    const text = `🔐 Your verification code: **${result.code}**\n`
      + `Enter it on the website within ${result.minutes} minutes to confirm your submission. Never share this code.`;
    if (await dm(user.id, text)) {
      await ephemeral('📩 I sent you a 6-digit code by DM. Enter it on the website.');
    } else {
      // DMs closed: show the code only to this user
      await ephemeral(`${text}\n\n_(I couldn't DM you: your direct messages are closed for this server.)_`);
    }
    return;
  }

  if (interaction.commandName === 'link') {
    if (!canModerate(interaction)) {
      await ephemeral('⛔ Only moderators can use this command.');
      return;
    }
    const name = interaction.options.getString('player', true).trim();
    const target = interaction.options.getUser('user', true);
    const result = store.linkPlayer(name, target.id);
    await ephemeral(result.error ? `⚠️ ${result.error}` : `🔗 "${result.player}" is now linked to <@${target.id}>.`);
    if (!result.error) syncMember(target.id);
    return;
  }

  if (interaction.commandName === 'manual-role') {
    if (!canManageRoles(interaction)) {
      await ephemeral('⛔ Only admins (Manage Roles permission) can use this command.');
      return;
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const rows = store.listManualRoles();
      await ephemeral(rows.length
        ? `✋ Roles given by hand:\n${rows.map((r) => `• **${ROLE_LABELS[r.role_key]}** — <@${r.discord_id}> (by ${r.added_by || '?'}, ${r.added_at.slice(0, 10)})`).join('\n')}`
        : 'No role given by hand.');
      return;
    }
    const target = interaction.options.getUser('user', true);
    const key = interaction.options.getString('role', true);
    if (!ROLE_IDS[key]) { await ephemeral(`⚠️ The ${ROLE_LABELS[key]} role is not configured in .env.`); return; }
    if (sub === 'add') {
      const added = store.addManualRole(target.id, key, interaction.user.username);
      await syncMember(target.id);
      await ephemeral(added
        ? `✅ <@${target.id}> now has **${ROLE_LABELS[key]}**, given by hand: the automatic sync will never remove it.`
        : `<@${target.id}> already had **${ROLE_LABELS[key]}** given by hand.`);
    } else {
      const removed = store.removeManualRole(target.id, key);
      await syncMember(target.id);
      await ephemeral(removed
        ? `🗑️ Manual **${ROLE_LABELS[key]}** removed for <@${target.id}>: they keep it only if the leaderboard gives it to them.`
        : `<@${target.id}> had no **${ROLE_LABELS[key]}** given by hand.`);
    }
    return;
  }

  if (interaction.commandName === 'sync-roles') {
    if (!canModerate(interaction)) {
      await ephemeral('⛔ Only moderators can use this command.');
      return;
    }
    if (!rolesEnabled()) { await ephemeral('No role is configured (DISCORD_*_ROLE_ID in .env).'); return; }
    if (!membersIntent) { await ephemeral('⚠️ The "Server Members Intent" is not enabled for the bot: roles cannot be synced.'); return; }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const r = await syncRoles();
    await interaction.editReply(`🔄 Roles updated: ${r.summary}`);
  }
}

// ---------- Automatic roles ----------
async function getGuild() {
  const channel = await client.channels.fetch(CHANNEL_ID);
  return channel.guild;
}

// Adds / removes the configured roles of one member; returns the number of changes
async function applyRoles(member, holders, counts) {
  if (member.user.bot) return;
  for (const [key, roleId] of Object.entries(ROLE_IDS)) {
    if (!roleId) continue;
    const want = holders[key].has(member.id);
    const has = member.roles.cache.has(roleId);
    if (want === has) continue;
    try {
      if (want) await member.roles.add(roleId, 'MK8DX Times leaderboard');
      else await member.roles.remove(roleId, 'MK8DX Times leaderboard');
      if (counts) counts[key][want ? 'added' : 'removed'] += 1;
    } catch (e) {
      console.error(`[roles] Could not ${want ? 'give' : 'remove'} ${ROLE_LABELS[key]} for ${member.user.tag}: ${e.message}`);
      if (counts) counts.errors += 1;
    }
  }
}

let syncing = null;
// Full sync: every member of the server gets exactly the roles the leaderboard says
function syncRoles() {
  if (syncing) return syncing;
  syncing = (async () => {
    const guild = await getGuild();
    const missing = Object.entries(ROLE_IDS).filter(([, id]) => id && !guild.roles.cache.has(id)).map(([k]) => ROLE_LABELS[k]);
    if (missing.length) console.warn(`[roles] Role(s) not found on the server: ${missing.join(', ')} — check the IDs in .env`);
    const members = await guild.members.fetch();
    const holders = store.roleHolders();
    const counts = { errors: 0 };
    Object.keys(ROLE_IDS).forEach((k) => { counts[k] = { added: 0, removed: 0 }; });
    for (const member of members.values()) await applyRoles(member, holders, counts);
    store.kvSet('roles_synced_at', Date.now());
    const summary = Object.entries(ROLE_IDS).filter(([, id]) => id)
      .map(([k]) => `${ROLE_LABELS[k]} +${counts[k].added}/−${counts[k].removed}`).join(', ')
      + (counts.errors ? ` (${counts.errors} error(s): check that the bot's role is above these roles and has "Manage Roles")` : '');
    console.log(`[roles] Sync done on ${members.size} members: ${summary}`);
    return { counts, summary };
  })().finally(() => { syncing = null; });
  return syncing;
}

// One member only (new member, account linked or deleted): called without waiting
async function syncMember(discordId) {
  if (!ready || !rolesEnabled() || !discordId) return;
  try {
    const guild = await getGuild();
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (member) await applyRoles(member, store.roleHolders());
  } catch (e) {
    console.error('[roles] Member sync failed:', e.message);
  }
}

// Runs the full sync when the last one is older than ROLE_SYNC_HOURS (checked every hour)
function scheduleRoleSync() {
  if (!rolesEnabled() || !membersIntent) return;
  const check = () => {
    const last = Number(store.kvGet('roles_synced_at') || 0);
    if (Date.now() - last >= ROLE_SYNC_HOURS * 3600000) {
      syncRoles().catch((e) => console.error('[roles] Sync failed:', e.message));
    }
  };
  setTimeout(check, 30 * 1000).unref();
  setInterval(check, 60 * 60 * 1000).unref();
}

// Sends the verified submissions that arrived while the bot was offline
async function sendBacklog() {
  const subs = store.unsentSubmissions();
  for (const sub of subs) await notifySubmission(sub);
  if (subs.length) console.log(`[discord] ${subs.length} waiting submission(s) sent to the moderators.`);
}

async function registerCommands() {
  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel.guild) throw new Error('DISCORD_CHANNEL_ID must be a channel of a server.');
  // Registered on the server only: available instantly
  await channel.guild.commands.set(COMMANDS.map((c) => c.toJSON()));
  console.log(`[discord] Slash commands registered on "${channel.guild.name}".`);
}

async function start(withMembers = rolesEnabled()) {
  if (!TOKEN || !CHANNEL_ID) {
    console.warn('[discord] DISCORD_TOKEN or DISCORD_CHANNEL_ID missing: bot disabled.');
    return;
  }
  membersIntent = withMembers;
  // The members intent (privileged) is only needed for the automatic roles
  client = new Client({
    intents: withMembers ? [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] : [GatewayIntentBits.Guilds],
    // Set at login and re-sent automatically on every reconnection
    presence: { status: 'online', activities: [{ type: ActivityType.Custom, name: 'Custom Status', state: BOT_STATUS }] },
  });
  client.once(Events.ClientReady, (c) => {
    ready = true;
    console.log(`[discord] Logged in as ${c.user.tag}`);
    registerCommands().catch((e) => console.error('[discord] Could not register slash commands:', e.message));
    sendBacklog().catch((e) => console.error('[discord] Could not send waiting submissions:', e.message));
    scheduleRoleSync();
  });
  // Someone joins the server: if they already have an account on the site, they get their roles right away
  client.on(Events.GuildMemberAdd, (member) => { syncMember(member.id); });
  client.on(Events.InteractionCreate, (interaction) => {
    handleInteraction(interaction).catch((err) => {
      console.error('[discord] Interaction error:', err);
      if (interaction.isRepliable() && !interaction.replied) {
        interaction.reply({ content: '⚠️ Something went wrong.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    });
  });
  try {
    await client.login(TOKEN);
  } catch (e) {
    if (withMembers && /disallowed intents/i.test(e.message)) {
      console.error('[roles] The bot is not allowed to see the server members. Enable "Server Members Intent" in the Developer Portal '
        + '(your application > Bot > Privileged Gateway Intents). The bot starts without automatic roles.');
      client.destroy();
      return start(false);
    }
    throw e;
  }
}

const isEnabled = () => Boolean(TOKEN && CHANNEL_ID);

module.exports = { start, isEnabled, notifySubmission, notifyPending, syncMember, syncRoles, buildEmbed, buildButtons, handleInteraction, COMMANDS };
