'use strict';

ObjC.import('Foundation');
ObjC.import('Security');

const MAX_SECRET_BYTES = 16384;
const ERR_SEC_SUCCESS = 0;
const ERR_SEC_DUPLICATE_ITEM = -25299;
const ERR_SEC_ITEM_NOT_FOUND = -25300;

function dictionary() {
  return $.NSMutableDictionary.alloc.init;
}

function queryFor(service, account) {
  const query = dictionary();
  query.setObjectForKey($.kSecClassGenericPassword, $.kSecClass);
  query.setObjectForKey($(service), $.kSecAttrService);
  query.setObjectForKey($(account), $.kSecAttrAccount);
  return query;
}

function readStandardInput() {
  const input = $.NSFileHandle.fileHandleWithStandardInput;
  const secret = $.NSMutableData.alloc.init;
  while (Number(secret.length) <= MAX_SECRET_BYTES) {
    const remaining = MAX_SECRET_BYTES + 1 - Number(secret.length);
    const chunk = input.readDataOfLength(remaining);
    if (Number(chunk.length) === 0) break;
    secret.appendData(chunk);
    if (Number(secret.length) > MAX_SECRET_BYTES) {
      throw new Error('Keychain secret exceeds the supported size');
    }
  }
  if (Number(secret.length) === 0) {
    throw new Error('Keychain secret is required');
  }
  return secret;
}

function copySecret(query) {
  query.setObjectForKey($.kCFBooleanTrue, $.kSecReturnData);
  query.setObjectForKey($.kSecMatchLimitOne, $.kSecMatchLimit);
  const result = Ref();
  const status = Number($.SecItemCopyMatching(query, result));
  if (status !== ERR_SEC_SUCCESS) {
    throw new Error(`Keychain read failed with status ${status}`);
  }
  const secret = result[0];
  const length = Number(secret.length);
  if (length < 1 || length > MAX_SECRET_BYTES) {
    throw new Error('Keychain secret has an invalid size');
  }
  return secret;
}

function writeSecret(query) {
  const secret = readStandardInput();
  const update = dictionary();
  update.setObjectForKey(secret, $.kSecValueData);
  let status = Number($.SecItemUpdate(query, update));
  if (status === ERR_SEC_ITEM_NOT_FOUND) {
    query.setObjectForKey(secret, $.kSecValueData);
    status = Number($.SecItemAdd(query, null));
    if (status === ERR_SEC_DUPLICATE_ITEM) {
      query.removeObjectForKey($.kSecValueData);
      status = Number($.SecItemUpdate(query, update));
    }
  }
  if (status !== ERR_SEC_SUCCESS) {
    throw new Error(`Keychain write failed with status ${status}`);
  }
}

function run(argv) {
  if (argv.length !== 3 || !argv[0] || !argv[1] || !argv[2]) {
    throw new Error('Keychain operation, service, and account are required');
  }

  const operation = argv[0];
  const query = queryFor(argv[1], argv[2]);
  if (operation === 'write') {
    writeSecret(query);
  } else if (operation === 'read') {
    $.NSFileHandle.fileHandleWithStandardOutput.writeData(copySecret(query));
  } else if (operation === 'exists') {
    copySecret(query);
  } else if (operation === 'delete') {
    const status = Number($.SecItemDelete(query));
    if (status !== ERR_SEC_SUCCESS && status !== ERR_SEC_ITEM_NOT_FOUND) {
      throw new Error(`Keychain delete failed with status ${status}`);
    }
  } else {
    throw new Error('Unsupported Keychain operation');
  }
  return '';
}
