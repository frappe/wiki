<br>
<br>

<div align="center">
<img width="150" alt="logotype" src="https://user-images.githubusercontent.com/28212972/128001084-508e446f-2814-4e1f-a5cb-09598f5a5bdc.png">
</div>

<br>

---

<div align="center">
 Wiki App built on the <a href= "https://frappeframework.com" >Frappe Framework</a> | <a href = "https://wiki-docs.frappe.cloud/use_on_frappe_cloud">Try on Frappe Cloud</a>
 
 \
 [![Wiki](https://img.shields.io/endpoint?url=https://cloud.cypress.io/badge/simple/w2jgcb/master&style=flat&logo=cypress)](https://cloud.cypress.io/projects/w2jgcb/runs)
 [![CI](https://github.com/frappe/wiki/actions/workflows/ci.yml/badge.svg?event=push)](https://github.com/frappe/wiki/actions/workflows/ci.yml)
</div>

## Introduction

Frappe Wiki is an Open Source [Wiki](https://en.wikipedia.org/wiki/Wiki) app built on the <a href= "https://frappeframework.com" >Frappe Framework</a>. It is well suited to serve dynamic, text-heavy content like documentation and knowledge base. It allows publishing small changes and even new pages on the fly without downtime. It also maintains revision history and has a change approval mechanism.

## Installation

```bash
# get app
$ bench get-app https://github.com/frappe/wiki

# install on site
$ bench --site sitename install-app wiki
```

> [!NOTE]  
> Use `version-14` branch with Frappe Framework v14 and for v14+ use `master` branch.

## Features

1. Create Wiki Pages
2. Author content in Rich Text
3. Set-up Controlled Wiki Updates
5. Add attachments
6. Table of Contents
7. Caching
8. Custom Script Support via `Wiki Settings`

## Screenshots

### 1. Rendered Page
<img width="1552" alt="wiki-rendered" src="https://github.com/user-attachments/assets/11d4eea0-adf6-475c-a380-206ece8de9f1">

### 2. Edit Page
<img width="1552" alt="wiki-edit" src="https://github.com/user-attachments/assets/748052ab-2391-47c1-a8e5-674214d5de26">

#### License

MIT
