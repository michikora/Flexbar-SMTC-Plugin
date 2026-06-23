use napi::{bindgen_prelude::*, Result};
use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;

use crate::types::MediaInfo;
use crate::utils;

#[napi]
pub fn get_current_session() -> Result<Option<MediaInfo>> {
  let manager = create_manager()?;

  manager
    .GetCurrentSession()
    .ok()
    .map_or(Ok(None), |session| {
      utils::get_media_info_for_session(&session)
    })
}

#[napi]
pub fn get_sessions() -> Result<Vec<MediaInfo>> {
  let manager = create_manager()?;
  let sessions = match manager.GetSessions() {
    Ok(s) => s,
    Err(_) => return Ok(Vec::new()),
  };
  
  let size = match sessions.Size() {
    Ok(s) => s,
    Err(_) => return Ok(Vec::new()),
  };

  let mut result = Vec::new();
  for i in 0..size {
    let session = match sessions.GetAt(i) {
      Ok(s) => s,
      Err(_) => continue,
    };
    
    if let Ok(Some(info)) = utils::get_media_info_for_session(&session) {
      result.push(info);
    }
  }

  Ok(result)
}

#[napi]
pub fn get_session_by_id(source_app_id: String) -> Result<Option<MediaInfo>> {
  let manager = create_manager()?;
  let sessions = match manager.GetSessions() {
    Ok(s) => s,
    Err(_) => return Ok(None),
  };
  
  let size = match sessions.Size() {
    Ok(s) => s, 
    Err(_) => return Ok(None),
  };

  for i in 0..size {
    let session = match sessions.GetAt(i) {
      Ok(s) => s,
      Err(_) => continue,
    };
    
    let id = match session.SourceAppUserModelId() {
      Ok(id) => id,
      Err(_) => continue,
    };
    
    if id.to_string() == source_app_id {
      return utils::get_media_info_for_session(&session);
    }
  }

  Ok(None)
}

pub fn create_manager() -> Result<GlobalSystemMediaTransportControlsSessionManager> {
  let operation = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
    .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

  operation
    .get()
    .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

fn get_raw_session_by_id(source_app_id: &str) -> Result<Option<windows::Media::Control::GlobalSystemMediaTransportControlsSession>> {
  let manager = create_manager()?;
  let sessions = manager.GetSessions().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
  let size = sessions.Size().unwrap_or(0);
  for i in 0..size {
    if let Ok(session) = sessions.GetAt(i) {
      if let Ok(id) = session.SourceAppUserModelId() {
        if id.to_string() == source_app_id {
          return Ok(Some(session));
        }
      }
    }
  }
  Ok(None)
}

#[napi]
pub fn try_play(source_app_id: String) -> Result<bool> {
  let session = get_raw_session_by_id(&source_app_id)?.ok_or_else(|| Error::new(Status::GenericFailure, "Session not found"))?;
  let op = session.TryPlayAsync().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
  op.get().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[napi]
pub fn try_pause(source_app_id: String) -> Result<bool> {
  let session = get_raw_session_by_id(&source_app_id)?.ok_or_else(|| Error::new(Status::GenericFailure, "Session not found"))?;
  let op = session.TryPauseAsync().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
  op.get().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[napi]
pub fn try_toggle_play_pause(source_app_id: String) -> Result<bool> {
  let session = get_raw_session_by_id(&source_app_id)?.ok_or_else(|| Error::new(Status::GenericFailure, "Session not found"))?;
  let op = session.TryTogglePlayPauseAsync().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
  op.get().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[napi]
pub fn try_skip_next(source_app_id: String) -> Result<bool> {
  let session = get_raw_session_by_id(&source_app_id)?.ok_or_else(|| Error::new(Status::GenericFailure, "Session not found"))?;
  let op = session.TrySkipNextAsync().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
  op.get().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[napi]
pub fn try_skip_previous(source_app_id: String) -> Result<bool> {
  let session = get_raw_session_by_id(&source_app_id)?.ok_or_else(|| Error::new(Status::GenericFailure, "Session not found"))?;
  let op = session.TrySkipPreviousAsync().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
  op.get().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[napi]
pub fn try_change_shuffle_active(source_app_id: String, active: bool) -> Result<bool> {
  let session = get_raw_session_by_id(&source_app_id)?.ok_or_else(|| Error::new(Status::GenericFailure, "Session not found"))?;
  let op = session.TryChangeShuffleActiveAsync(active).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
  op.get().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[napi]
pub fn try_change_auto_repeat_mode(source_app_id: String, mode: u8) -> Result<bool> {
  let session = get_raw_session_by_id(&source_app_id)?.ok_or_else(|| Error::new(Status::GenericFailure, "Session not found"))?;
  let repeat_mode = match mode {
    0 => windows::Media::MediaPlaybackAutoRepeatMode::None,
    1 => windows::Media::MediaPlaybackAutoRepeatMode::Track,
    2 => windows::Media::MediaPlaybackAutoRepeatMode::List,
    _ => return Err(Error::new(Status::InvalidArg, "Invalid repeat mode (0, 1, 2)")),
  };
  let op = session.TryChangeAutoRepeatModeAsync(repeat_mode).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
  op.get().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}