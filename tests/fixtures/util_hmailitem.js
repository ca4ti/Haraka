'use strict';

const { Address }     = require('address-rfc2821');
const fixtures        = require('haraka-test-fixtures');
const stub_connection = fixtures.connection;
// const transaction     = fixtures.transaction;  // not yet sufficient
const transaction     = require('../../transaction');


/**
 * Creates a HMailItem instance, which is passed to callback. Reports error on test param if creation fails.
 *
 * @param outbound_context
 * @param test
 * @param options
 * @param callback
 */
exports.newMockHMailItem = (outbound_context, test, options, callback) => {
    const opts = options || {};
    exports.createHMailItem(
        outbound_context,
        opts,
        (err, hmail) => {
            if (err) {
                test.ok(false, `Could not create HMailItem: ${err}`);
                test.done();
                return;
            }
            if (!hmail.todo) {
                hmail.once('ready', () => {
                    setImmediate(() => {callback(hmail);});
                });
            }
            else {
                callback(hmail);
            }
        }
    );
}

/**
 * Creates a HMailItem instance for testing purpose
 *
 * @param outbound_context: The context of the outbound.js, e.g. from require('nodeunit').utils.sandbox("outbound.js")
 * @param options
 * @param callback(err, hmail)
 */
exports.createHMailItem = (outbound_context, options, callback) => {

    const mail_from = options.mail_from || 'sender@domain';
    const delivery_domain = options.delivery_domain || 'domain';
    const mail_recipients = options.mail_recipients || [new Address('recipient@domain')];

    const conn = stub_connection.createConnection();
    conn.transaction = transaction.createTransaction('someuuid');
    conn.transaction.mail_from = new Address(mail_from);

    const todo = new outbound_context.TODOItem(delivery_domain, mail_recipients, conn.transaction);
    todo.uuid = `${todo.uuid}.1`;

    let contents = [
        `From: ${mail_from}`,
        `To: ${mail_recipients.join(", ")}`,
        "MIME-Version: 1.0",
        "Content-type: text/plain; charset=us-ascii",
        "Subject: Some subject here",
        "",
        "Some email body here",
        ""].join("\n");
    let match;
    const re = /^([^\n]*\n?)/;
    while ((match = re.exec(contents))) {
        let line = match[1];
        line = line.replace(/\r?\n?$/, '\r\n'); // make sure it ends in \r\n
        conn.transaction.add_data(Buffer.from(line));
        contents = contents.substr(match[1].length);
        if (contents.length === 0) {
            break;
        }
    }
    conn.transaction.message_stream.add_line_end();

    const hmails = [];
    const ok_paths = [];
    outbound_context.exports.process_delivery(ok_paths, todo, hmails, err => {
        if (err) {
            callback(`process_delivery error: ${err}`);
            return;
        }
        if (hmails.length == 0) {
            callback('No hmail producted');
            return;
        }
        for (const hmail of hmails) {
            hmail.hostlist = [ delivery_domain ];
            callback(null, hmail);
        }
    });

}

/**
 * runs a socket.write
 * @param socket
 * @param test
 * @param playbook
 */
exports.playTestSmtpConversation = (hmail, socket, test, playbook, callback) => {
    const testmx = {
        bind_helo: "haraka.test",
        exchange: "remote.testhost",
    };
    hmail.try_deliver_host_on_socket(testmx, 'testhost', 'testport', socket);

    socket.write = line => {
        //console.log('MockSocket.write(' + line.replace(/\n/, '\\n').replace(/\r/, '\\r') + ')');
        if (playbook.length == 0) {
            test.ok(false, 'missing next playbook entry');
            test.done();
            return;
        }
        let expected;
        while (false != (expected = getNextEntryFromPlaybook('haraka', playbook))) {
            if (typeof expected.test === 'function') {
                test.ok(expected.test(line), expected.description || `Expected that line works with func: ${expected.test}`);
            }
            else {
                test.equals(`${expected.test}\r\n`, line, expected.description || `Expected that line equals: ${expected.test}`);
            }
            if (expected.end_test === true) {
                setTimeout(() => {
                    callback();
                }, 0);
                return;
            }
        }
        setTimeout(() => {
            let nextMessageFromServer;
            while (false != (nextMessageFromServer = getNextEntryFromPlaybook('remote', playbook))) {
                socket.emit('line', `${nextMessageFromServer.line}\r\n`);
            }
        }, 0);
    }

    const welcome = getNextEntryFromPlaybook('remote', playbook);
    socket.emit('line', welcome.line);

}

function getNextEntryFromPlaybook (ofType, playbook) {
    if (playbook.length == 0) {
        return false;
    }
    if (playbook[0].from == ofType) {
        return playbook.shift();
    }
    return false;
}

