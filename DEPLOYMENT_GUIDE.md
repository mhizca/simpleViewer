# SimpleViewer Deployment Guide

## Overview
This document details the complete deployment process for the SimpleViewer application on Ubuntu VPS.

## Application Details
- **Application**: SimpleViewer - A web application for viewing and comparing images
- **Port**: 3000 (internal), 80 (public via Nginx)
- **Authentication**: Session-based login system
- **Process Manager**: PM2
- **Web Server**: Nginx (reverse proxy)

## Deployment Steps Completed

### 1. Install Node.js Dependencies
```bash
cd /home/ubuntu/simpleViewer
npm install
```
- Installed 77 packages including Express, CORS, dotenv, and express-session

### 2. Environment Configuration
The application uses a `.env` file located at `/home/ubuntu/simpleViewer/.env` with the following variables:
- `LOGIN_USERNAME`: Authentication username
- `LOGIN_PASSWORD`: Authentication password  
- `SESSION_SECRET`: Secret key for Express sessions
- `PORT`: Application port (default: 3000)

### 3. Install and Configure PM2
```bash
sudo npm install -g pm2
```
PM2 was installed globally to manage the Node.js process with features like:
- Auto-restart on crashes
- Log management
- Process monitoring

### 4. Configure Nginx as Reverse Proxy
Nginx was installed and configured to proxy requests from port 80 to the Node.js application on port 3000.

**Nginx Configuration** (`/etc/nginx/sites-available/simpleviewer`):
```nginx
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    client_max_body_size 100M;
}
```

Steps taken:
- Installed Nginx: `sudo apt install -y nginx`
- Created configuration file
- Enabled the site: `sudo ln -s /etc/nginx/sites-available/simpleviewer /etc/nginx/sites-enabled/`
- Removed default site: `sudo rm /etc/nginx/sites-enabled/default`
- Tested configuration: `sudo nginx -t`
- Restarted Nginx: `sudo systemctl restart nginx`

### 5. Firewall Configuration
UFW (Uncomplicated Firewall) was configured to allow necessary traffic:
```bash
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS (for future SSL)
sudo ufw --force enable
```

### 6. Start Application with PM2
```bash
pm2 start server.js --name simpleviewer
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

This ensures:
- Application runs as a daemon
- Automatic restart on server reboot
- Process monitoring and log management

## Current Server Configuration

### Services Running
1. **Nginx**: Listening on port 80, proxying to localhost:3000
2. **PM2**: Managing the Node.js process (simpleviewer)
3. **Node.js Application**: Running on port 3000

### File Locations
- Application: `/home/ubuntu/simpleViewer/`
- Nginx Config: `/etc/nginx/sites-available/simpleviewer`
- PM2 Logs: `/home/ubuntu/.pm2/logs/`
- Environment Variables: `/home/ubuntu/simpleViewer/.env`

### Access Points
- Web Interface: `http://[YOUR_VPS_IP]/`
- Login Required: Yes (credentials in .env file)

## Management Commands

### Application Management
```bash
# View application status
pm2 status

# View logs
pm2 logs simpleviewer

# Restart application
pm2 restart simpleviewer

# Stop application
pm2 stop simpleviewer

# Start application
pm2 start simpleviewer
```

### Nginx Management
```bash
# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx

# Restart Nginx
sudo systemctl restart nginx

# Check Nginx status
sudo systemctl status nginx
```

### Monitoring
```bash
# View PM2 dashboard
pm2 monit

# View application logs in real-time
pm2 logs simpleviewer --lines 100

# Check system resources
pm2 list
```

## Security Considerations
1. Firewall is enabled with only necessary ports open
2. Application uses session-based authentication
3. Nginx acts as a reverse proxy, hiding the Node.js application
4. Environment variables are stored securely in .env file
5. Consider adding SSL certificate for HTTPS in production

## Next Steps (Optional)
1. Configure SSL/TLS certificate (Let's Encrypt)
2. Set up domain name
3. Configure backup strategy
4. Set up monitoring alerts
5. Implement rate limiting