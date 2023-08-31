import 'dotenv/config';

import config from 'config';
import { REST, RESTPostAPIChatInputApplicationCommandsJSONBody, RouteLike, Routes } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import loggerModule from '../services/logger';
import { SystemOptions } from '../types/configTypes';
import { Logger } from 'pino';

const systemOptions: SystemOptions = config.get('systemOptions');

const executionId: string = uuidv4();

const logger: Logger = loggerModule.child({
    module: 'deploy',
    name: 'deploySlashCommands',
    executionId: executionId
});

//TODO: Fix deploying not working with require()

const slashCommands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];
const systemCommands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];
const commandFolders: string[] = fs.readdirSync(path.resolve('./dist/interactions/commands'));

if (!process.env.DISCORD_BOT_TOKEN) {
    throw new Error('DISCORD_BOT_TOKEN environment variable is not set.');
}

if (!process.env.DISCORD_APPLICATION_ID) {
    throw new Error('DISCORD_APPLICATION_ID environment variable is not set.');
}

const rest: REST = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
    if (!process.env.DISCORD_APPLICATION_ID || !process.env.DISCORD_BOT_TOKEN) {
        logger.error(
            'Missing required environment variables for deployment.\nPlease provide valid DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN in .env file.'
        );
        process.exit(1);
    }

    for (const folder of commandFolders) {
        const commandFiles: string[] = fs
            .readdirSync(path.resolve(`./dist/interactions/commands/${folder}`))
            .filter((file) => file.endsWith('.js'));

        for (const file of commandFiles) {
            // TODO: create commandModule type
            const { default: command } = await import(`../interactions/commands/${folder}/${file}`);
            command.isSystemCommand
                ? systemCommands.push(command.data.toJSON())
                : slashCommands.push(command.data.toJSON());
        }
    }

    try {
        logger.debug(`Bot user slash commands found: ${slashCommands.map((command) => `/${command.name}`).join(', ')}`);

        logger.info('Started refreshing user slash commands.');
        await refreshCommands(Routes.applicationCommands(process.env.DISCORD_APPLICATION_ID!), slashCommands);
        logger.info('Successfully refreshed user slash commands.');
    } catch (error) {
        logger.error(error, 'Failed to refresh user slash commands.');
    }

    try {
        logger.debug(
            `Bot system slash commands found: ${systemCommands
                .map((systemCommand) => `/${systemCommand.name}`)
                .join(', ')}`
        );

        logger.info('Started refreshing system slash commands.');
        const systemGuildIds: string[] = systemOptions.systemGuildIds;
        await Promise.all(
            systemGuildIds.map((systemGuildId: string) => {
                logger.debug(`Refreshing system slash command for guild id '${systemGuildId}'.`);
                refreshCommands(
                    Routes.applicationGuildCommands(process.env.DISCORD_APPLICATION_ID!, systemGuildId),
                    systemCommands
                );
            })
        );
        logger.info('Successfully refreshed system slash commands.');
    } catch (error) {
        logger.error(
            error,
            "Failed to refresh system slash commands. Make sure the bot is in the system guilds specified in 'systemOptions'."
        );
    }
})();

async function refreshCommands(route: RouteLike, commands: object[]) {
    await rest.put(route, { body: commands });
}
