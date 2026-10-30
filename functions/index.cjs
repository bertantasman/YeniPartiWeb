const {initializeApp} = require('firebase-admin/app');
const {getAuth} = require('firebase-admin/auth');
const {getFirestore, FieldValue, FieldPath} = require('firebase-admin/firestore');
const {onCall, HttpsError} = require('firebase-functions/v2/https');
const {makeHandler} = require('./management.cjs');
initializeApp();
const handler = makeHandler({db:getFirestore(),auth:getAuth(),FieldValue,FieldPath,HttpsError});
exports.webAdminUsers = onCall({region:'us-central1',maxInstances:3,timeoutSeconds:60,memory:'256MiB',cors:['http://localhost:4173','http://127.0.0.1:4173','https://yeniparti-yonetim-paneli.tunedllama514.chatgpt.site']}, handler);
