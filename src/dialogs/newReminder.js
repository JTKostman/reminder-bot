const consts = require('../helpers/consts');
const utils = require('../helpers/utils');
const witClient = require('../api_clients/witClient');
const moment = require('moment-timezone');
const Reminder = require('../models/reminder');

module.exports = [
    (session, args, next) => {
        const { reminder, datetime, message } = args;
        const { dialogData, userData } = session;

        // dialog should not run without reminder argument
        if(!reminder) {
            return session.error(new Error('Invalid arguments object: reminder property is undefined'));
        }
        // dialog should not run without message argument
        if(!message) {
            return session.error(new Error('Invalid arguments object: message property is undefined'));
        }

        // Cache received arguments
        dialogData.reminder = reminder[0].value;
        dialogData.datetime = datetime ? utils.processDatetimeEntity(datetime) : null;
        dialogData.message = message;

        // Prompt the user to set a timezone in case this has not been set upon the first run
        if (!userData.timeZoneData) {
            session.beginDialog('/setTimezone', {
                prompt: consts.Prompts.NEED_TIMEZONE
            });
        } else {
            next();
        }
    },
    (session, results, next) => {
        const { reminder, datetime } = session.dialogData;

        // Prompt the user to set a date/time if necessary
        if (!datetime) {
            session.beginDialog('/setDatetime', { reminder });
        } else {
            next();
        }
    },
    (session, results) => {
        const { dialogData, userData} = session;
        const { reminder } = dialogData;
        const { dstOffset, rawOffset, timeZoneId } = userData.timeZoneData;
        const isAdjustedToTimezone = /\bin.+(hour[s]?|minute[s]?)/i;

        // At this point, either session.dialogData.datetime or results.datetime has the datetime value
        const datetime = results.datetime ? results.datetime : dialogData.datetime;
        const message = dialogData.message + (results.text ? ` ${results.text}` : '');

        // All reminders are saved in UTC (coordinated universal time).
        // In most cases the datetime needs to be adjusted to reflect the user's timezone before saving to MongoDB.
        // However, when the user types something like "in 2 hours" or "in 50 minutes", this does not need to happen.
        var expiration;
        if (isAdjustedToTimezone.test(message)) {
            expiration = moment(datetime).toDate();
        } else {
            // Normalize datetime to UTC before saving to MongoDB
            const offset = (rawOffset + dstOffset) / 3600;
            const method = offset >= 0 ? 'subtract' : 'add';
            expiration = moment(datetime)[method](offset, 'hour').toDate();
        }

        const newReminder = {
            user_address: session.message.address,
            value: reminder,
            expiration
        };

        Reminder.create(newReminder, err => {
            if (err !== null) {
                return session.error(err);
            }

            session.endDialog(
                consts.Messages.CONFIRM_REMINDER, /* formatted string containing two string placeholders */
                reminder, /* replaces first */
                utils.convertTimestamp(expiration, timeZoneId) /* replaces second */
            );
        });
    }
];