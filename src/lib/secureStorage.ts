import * as SecureStore from 'expo-secure-store';

import { createChunkedStorage } from './chunkedStorage';

// Session storage backed by the iOS Keychain and Android Keystore.
//
// WHEN_UNLOCKED_THIS_DEVICE_ONLY: tokens can only be read while the phone is
// unlocked, and are never restored onto another phone from a backup. Someone
// moving phones simply signs in again with a new email code. On Android, the
// expo-secure-store config plugin excludes this data from Android's automatic
// backup (we have no custom backup rules, so its default applies).
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const secureStorage = createChunkedStorage({
  getItemAsync: (key) => SecureStore.getItemAsync(key, options),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, options),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key, options),
});
