{
  pkgs ? import (builtins.fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/0d765791b09356dd5b356559c1b67c1600ca3c5b.tar.gz";
  }) { },
}:

pkgs.mkShellNoCC {
  packages =  with pkgs; [
    ncurses
    git
    bun
    just
    # nodejs_24
    curl
    jq
    ripgrep
    coreutils
  ];
}
