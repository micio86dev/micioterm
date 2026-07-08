//! Startup banner (spec §4.1). A compact MicioDev logo plus the MicioTerm
//! wordmark, printed in neon green in every new pane before the shell prompt.
//! Fixed asset — do not regenerate.

const BANNER_ART: &str = r#"
                %%%%             %%%%%
               %@   %%% %%%%%  %%%   @
               %%     %%%    %%%     %%
               %%                    %%
                @                   %@
              %%%                    %%
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      @ %%%%                        %%%% @
      @ %%                            %% @
      @ %%        %%     @  %%        %% @
      @ %%      %%%     @%   %%%      %%%@
      @ %%     %%      %%     %@%     %%%@
      @ %%       %%   %%     %%       %% @
      @ %%        %   %     %         %% @
      @ %%                            %% @
      @ %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%% @
      @                                 %@
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
                           %      %
               %%%%  %%%%%%%%%%%%%%%%%%
               %@%          %       %@%
                 %%%       %%       %%
                   %%    %%%  %    %%
                     %%%%%%%%%%   %%
                        %%%%%%    %%
                          %@%    %%
                            %%  %%
                              %%%

             __  ____      _     ______
   /  |/  (_)____(_)___/_  __/__  _________ ___
  / /|_/ / / ___/ / __ \/ / / _ \/ ___/ __ `__ \
 / /  / / / /__/ / /_/ / / /  __/ /  / / / / / /
/_/  /_/_/\___/_/\____/_/  \___/_/  /_/ /_/ /_/
"#;

/// Bytes to emit on a new pane's output channel, or empty when disabled.
///
/// Bold neon green `#2fff5a` via truecolor, prefixed with a bright-green
/// `\x1b[1;92m` fallback for non-truecolor terminals. CRLF line endings so the
/// raw terminal renders each line left-aligned; resets color at the end.
pub fn banner_bytes(show: bool) -> Vec<u8> {
    if !show {
        return Vec::new();
    }
    let art = BANNER_ART.trim_start_matches('\n').replace('\n', "\r\n");
    format!("\x1b[1;92m\x1b[38;2;47;255;90m{art}\x1b[0m\r\n\r\n").into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_banner_is_empty() {
        assert!(banner_bytes(false).is_empty());
    }

    #[test]
    fn enabled_banner_carries_art_color_and_reset() {
        let text = String::from_utf8(banner_bytes(true)).unwrap();
        assert!(text.contains("%%"), "banner must include the logo art");
        assert!(text.contains("Mi") || text.contains("_"), "banner must include the wordmark");
        assert!(text.contains("\x1b[38;2;47;255;90m"), "truecolor neon green");
        assert!(text.contains("\x1b[1;92m"), "bright-green fallback");
        assert!(text.contains("\x1b[0m"), "resets color");
        assert!(text.contains("\r\n"), "CRLF line endings");
    }
}
