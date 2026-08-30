'use strict';
// Minimal stub — real implementation is not required for server.test.js
function HorizonListener() {}
HorizonListener.prototype.start = async () => {};
HorizonListener.prototype.stop = () => {};

function HttpWebhookSender() {}
HttpWebhookSender.prototype.send = async () => {};

function RpcEventSource() {}

module.exports = { HorizonListener, HttpWebhookSender, RpcEventSource };
