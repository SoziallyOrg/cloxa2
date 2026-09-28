#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu/Debian VPS that will run Cloxa.
#
# Idempotent: safe to re-run. Run as root (or with sudo) over SSH.
#
#   ssh root@<vps-ip> 'bash -s' < deploy/scripts/bootstrap-vps.sh
#
# WARNING: this disables SSH password login and locks the firewall to
# 22/80/443. Keep your current SSH session open until you've confirmed you
# can log in again in a *second* session — if something is wrong, you still
# have the first session to fix it.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-cloxa}"

echo "==> Updating packages"
apt-get update -y
apt-get upgrade -y

echo "==> Installing base tools"
apt-get install -y ca-certificates curl gnupg ufw fail2ban unattended-upgrades

echo "==> Installing Docker Engine + Compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "Docker already installed, skipping"
fi

echo "==> Creating deploy user (${DEPLOY_USER})"
if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "${DEPLOY_USER}"
  usermod -aG docker "${DEPLOY_USER}"
  mkdir -p "/home/${DEPLOY_USER}/.ssh"
  if [ -f /root/.ssh/authorized_keys ]; then
    cp /root/.ssh/authorized_keys "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  fi
  chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
  chmod 700 "/home/${DEPLOY_USER}/.ssh"
  chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys" 2>/dev/null || true
  echo "Created ${DEPLOY_USER}. Add its SSH key to authorized_keys before relying on it,"
  echo "and set VPS_USER=${DEPLOY_USER} in the deploy workflow's secrets."
else
  echo "${DEPLOY_USER} already exists, skipping"
fi

echo "==> Firewall (ufw): allow 22, 80, 443 only"
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> fail2ban: enable the default sshd jail"
systemctl enable --now fail2ban

echo "==> Unattended security upgrades"
dpkg-reconfigure -f noninteractive unattended-upgrades || true
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

echo "==> Disabling SSH password login (keep this session open!)"
sshd_config="/etc/ssh/sshd_config"
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' "${sshd_config}"
sed -i 's/^#\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' "${sshd_config}"
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' "${sshd_config}"
# Ubuntu cloud images ship sshd_config.d/50-cloud-init.conf with
# "PasswordAuthentication yes", and sshd uses the FIRST value it reads. A drop-in
# that sorts first wins over it (and over sshd_config's own later lines).
cat > /etc/ssh/sshd_config.d/00-cloxa-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t
# Fail loudly if another file still wins.
sshd -T | grep -qx "passwordauthentication no" || {
  echo "Password login is still enabled; check /etc/ssh/sshd_config.d/." >&2
  exit 1
}
systemctl reload ssh

echo "==> Done. Open a NEW terminal now and confirm you can still log in"
echo "    (as ${DEPLOY_USER}, with your SSH key) before closing this session."
