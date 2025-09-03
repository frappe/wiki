<div align="center">

<img width="80" alt="wiki" src="https://github.com/user-attachments/assets/4869d211-fae2-4e93-8275-de433556feb0" />
<h1>Frappe Wiki</h1>

**Open Source Documentation Tool**

[![Wiki](https://img.shields.io/endpoint?url=https://cloud.cypress.io/badge/simple/w2jgcb/master&style=flat&logo=cypress)](https://cloud.cypress.io/projects/w2jgcb/runs)
[![CI](https://github.com/frappe/wiki/actions/workflows/ci.yml/badge.svg?event=push)](https://github.com/frappe/wiki/actions/workflows/ci.yml)

<img width="1582" alt="Hero Image" src="https://github.com/user-attachments/assets/b4bedd31-96fe-4c07-aded-339eade4a7d1" />

<br />
<br />
<a href="https://frappe.io/wiki">Website</a>
-
<a href="https://docs.frappe.io/wiki/">Documentation</a>
</div>

## Frappe Wiki

Frappe Wiki is an Open Source Wiki app built on the Frappe Framework. It is well suited to serve dynamic, text-heavy content like documentation and knowledge base. It allows publishing small changes and even new pages on the fly without downtime. It also maintains revision history and has a change approval mechanism.

<details>
<summary>Screenshots</summary>
<img width="1582" alt="Screenshot 2025-01-13 at 2 13 54 PM" src="https://github.com/user-attachments/assets/36120ff2-7dd4-4c29-ac02-131907ef381e" />
</details>


### Motivation

Frappe Wiki, like many of our products was developed for our own needs. We were looking for a simple, clean, open source wiki to write documentation for ERPNext, but due to a lack of good options, we decided to write our own from scratch!

Our goal was clear: create an open-source wiki that provides a delightful experience for writers and readers. Today, we use Frappe Wiki for all sorts of internal things – user manuals, company policies, you name it! The easy-to-use interface and simple editing features make it perfect for anyone on our team.


### Key Features

- **Create Wiki Pages**: Easily create and organize wiki pages to manage and share knowledge systematically.
Author Content in Markdown: Write and format content effortlessly using Markdown syntax, ensuring a clean and readable structure.
- **Set-up Controlled Wiki Updates**: Implement workflows to review and approve edits before publishing, ensuring content accuracy and consistency.
- **Add Attachments**: Attach relevant files and documents directly to wiki pages for better context and resource sharing.
- **Table of Contents**: Automatically generate a navigable table of contents for enhanced readability and structure.
- **Custom Script Support via Wiki Settings**: Customize wiki behavior and extend functionality using custom scripts configured in Wiki Settings.

### Under the Hood

- [**Frappe Framework**](https://github.com/frappe/frappe): A full-stack web application framework.

- [**Ace Editor**](https://github.com/ajaxorg/ace): Ace is an embeddable code editor written in JavaScript.

- [**RedisSearch**](https://github.com/RediSearch/RediSearch): A powerful search and indexing engine built on top of Redis.

## Production Setup

### Managed Hosting

You can try [Frappe Cloud](https://frappecloud.com), a simple, user-friendly and sophisticated [open-source](https://github.com/frappe/press) platform to host Frappe applications with peace of mind.

It takes care of installation, setup, upgrades, monitoring, maintenance and support of your Frappe deployments. It is a fully featured developer platform with an ability to manage and control multiple Frappe deployments.

<div>
    <a href="https://frappecloud.com/marketplace/apps/wiki" target="_blank">
        <picture>
            <source media="(prefers-color-scheme: dark)" srcset="https://frappe.io/files/try-on-fc-white.png">
            <img src="https://frappe.io/files/try-on-fc-black.png" alt="Try on Frappe Cloud" height="28" />
        </picture>
    </a>
</div>

## Development Setup


### Local

To setup the repository locally follow the steps mentioned below:

1. Setup bench by following the [Installation Steps](https://frappeframework.com/docs/user/en/installation) and start the server

```
bench start
```

2. In a separate terminal window, cd into `frappe-bench` directory and run the following commands:

```
# get app
$ bench get-app https://github.com/frappe/wiki

# install on site
$ bench --site sitename install-app wiki

```

## Learn and connect
- [Telegram Public Group](https://t.me/frappewiki)
- [Discuss Forum](https://discuss.frappe.io/c/wiki/72)
- [Documentation](https://docs.frappe.io/wiki/)
- [YouTube](https://www.youtube.com/@frappetech)

<br>
<br>
<div align="center" style="padding-top: 0.75rem;">
    <a href="https://frappe.io" target="_blank">
        <picture>
            <source media="(prefers-color-scheme: dark)" srcset="https://frappe.io/files/Frappe-white.png">
            <img src="https://frappe.io/files/Frappe-black.png" alt="Frappe Technologies" height="28"/>
        </picture>
    </a>
</div>
