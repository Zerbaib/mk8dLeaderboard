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

// Tells the previous record holders that their record was beaten (or tied)
function notifyRecordLost(sub, record) {
  if (!record.previous) return;
  const track = store.TRACK_BY_ID[sub.track_id];
  const where = `**${track ? track.name : sub.track_id} ${sub.cc}cc**`;
  const old = store.formatTime(record.previous.time_ms);
  const time = store.formatTime(sub.time_ms);
  const gap = ((record.previous.time_ms - sub.time_ms) / 1000).toFixed(3);
  const link = `${PUBLIC_URL}/track/${sub.track_id}/${sub.cc}cc`;
  for (const holder of record.holders || []) {
    if (!holder.discord_id || holder.discord_id === sub.discord_id) continue;
    dm(holder.discord_id, record.tied
      ? `🤝 **${sub.player_name}** ${flag(sub.country)} tied your record on ${where} (${old}). Time to break the tie! ${link}`
      : `⚠️ Your record on ${where} (${old}) was beaten by **${sub.player_name}** ${flag(sub.country)} with **${time}** (−${gap} s). Time to take it back! ${link}`);
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
    const { sub, changed, record } = result;
    if (!changed) {
      await interaction.reply({ content: `This submission has already been reviewed (${LABELS[sub.status]}).`, flags: MessageFlags.Ephemeral });
      return;
    }
    await refreshMessage(interaction, sub);
    if (record) webhook.announceRecord(sub, record);
    dm(sub.discord_id, `✅ Your time on **${trackLabel(sub)}** has been approved and is now on the leaderboard!`
      + `${record && !record.tied ? ' 🏆 **It is the new record!**' : ''} ${PUBLIC_URL}`);
    if (record) notifyRecordLost(sub, record);
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
const COMMANDS = [
  new SlashCommandBuilder().setName('verif')
    .setDescription('Get a 6-digit code by DM to verify your time submission on the website'),
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
  }
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

async function start() {
  if (!TOKEN || !CHANNEL_ID) {
    console.warn('[discord] DISCORD_TOKEN or DISCORD_CHANNEL_ID missing: bot disabled.');
    return;
  }
  client = new Client({
    intents: [GatewayIntentBits.Guilds],
    // Set at login and re-sent automatically on every reconnection
    presence: { status: 'online', activities: [{ type: ActivityType.Custom, name: 'Custom Status', state: BOT_STATUS }] },
  });
  client.once(Events.ClientReady, (c) => {
    ready = true;
    console.log(`[discord] Logged in as ${c.user.tag}`);
    registerCommands().catch((e) => console.error('[discord] Could not register slash commands:', e.message));
    sendBacklog().catch((e) => console.error('[discord] Could not send waiting submissions:', e.message));
  });
  client.on(Events.InteractionCreate, (interaction) => {
    handleInteraction(interaction).catch((err) => {
      console.error('[discord] Interaction error:', err);
      if (interaction.isRepliable() && !interaction.replied) {
        interaction.reply({ content: '⚠️ Something went wrong.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    });
  });
  await client.login(TOKEN);
}

const isEnabled = () => Boolean(TOKEN && CHANNEL_ID);

module.exports = { start, isEnabled, notifySubmission, notifyPending, buildEmbed, buildButtons, handleInteraction, COMMANDS };
