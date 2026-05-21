// shared.js

export const globalState = {
  currentGame: 1 // you can update this from your game logic
};

export function enforcePlayerState(player) {
  const nowGame = globalState.currentGame;

  const isSuspended =
    player.excluded === true ||
    (player.bannedUntilGame && player.bannedUntilGame > nowGame);

  if (isSuspended) {
    player.notificationsEnabled = false;
    player.portalAccess = false;
    player.present = false;
  } else {
    player.notificationsEnabled = true;
    player.portalAccess = true;
  }

  // If Firebase is initialized, sync back:
  if (window.firebase && firebase.firestore) {
    firebase.firestore().collection('players').doc(player.id).update({
      notificationsEnabled: player.notificationsEnabled,
      portalAccess: player.portalAccess,
      present: player.present
    }).catch(() => {});
  }

  return player;
}
