"""Publish the prepared static site through the existing Git credential sign-in."""
import argparse
import json
import os
import pathlib
import subprocess
import urllib.error
import urllib.request

PROJECT = pathlib.Path(__file__).resolve().parents[1]
STATE_FILE = PROJECT / '.publication-state.json'
REPOSITORY = 'fitme-market-research'


def git(*args, capture=False, optional=False):
    result = subprocess.run(['git', *args], cwd=PROJECT, text=True, capture_output=capture)
    if result.returncode and not optional:
        raise RuntimeError('Git command failed: ' + ' '.join(args[:2]))
    return result.stdout.strip() if capture else result.returncode


def credentials():
    environment = dict(os.environ, GCM_INTERACTIVE='never', GIT_TERMINAL_PROMPT='0')
    result = subprocess.run(['git', '-c', 'credential.interactive=false', 'credential', 'fill'],
                            input='protocol=https\nhost=github.com\nusername=JuulVossen\n\n',
                            text=True, capture_output=True, env=environment, cwd=PROJECT)
    if result.returncode:
        raise RuntimeError('The existing GitHub sign-in is unavailable; sign in with Git Credential Manager.')
    fields = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    token = fields.get('password')
    if not token:
        raise RuntimeError('The existing GitHub sign-in did not provide a credential.')
    return token


def main():
    parser = argparse.ArgumentParser()
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--check-access', action='store_true')
    action.add_argument('--publish', action='store_true')
    action.add_argument('--status', action='store_true')
    args = parser.parse_args()
    token = credentials()

    def api(route, method='GET', payload=None):
        request = urllib.request.Request('https://api.github.com' + route,
            data=None if payload is None else json.dumps(payload).encode(), method=method,
            headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                     'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'Fitme-Market-Research',
                     'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                content=response.read()
                return json.loads(content) if content else {}
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            try:
                detail=json.loads(error.read()).get('message', '')
            except Exception:
                detail='Request rejected'
            raise RuntimeError('GitHub API ' + str(error.code) + ': ' + detail) from None

    user = api('/user')
    owner = user['login']
    if owner.lower() != 'juulvossen':
        raise RuntimeError('The authenticated GitHub account differs from the selected account.')
    route='/repos/' + owner + '/' + REPOSITORY
    repo=api(route)
    if args.check_access:
        print(json.dumps({'authenticated_account': owner, 'name': user.get('name'),
                          'repository_exists': repo is not None,
                          'repository_url': repo.get('html_url') if repo else None}))
        return
    state=json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}

    def checkpoint(**values):
        state.update(values)
        STATE_FILE.write_text(json.dumps(state, indent=2)+'\n', encoding='utf-8')

    if args.publish:
        if repo is not None and state.get('repository_url') != repo['html_url']:
            raise RuntimeError('A repository with this name already exists. Inspect it before publishing.')
        if repo is None:
            repo=api('/user/repos', 'POST', {'name': REPOSITORY, 'private': False,
                'description':'Fitme Market Research: Talent Map and completed workplace research runs',
                'homepage':'https://' + owner.lower() + '.github.io/' + REPOSITORY + '/',
                'auto_init':False})
            checkpoint(stage='repository_created', owner=owner, repository_url=repo['html_url'],
                       resume_point='Commit the prepared site and push main, then enable Pages from /docs.')
        if not (PROJECT/'.git').exists():
            git('init','-b','main')
        if not git('config','user.name',capture=True,optional=True):
            git('config','user.name',user.get('name') or owner)
        if not git('config','user.email',capture=True,optional=True):
            git('config','user.email',str(user['id'])+'+'+owner+'@users.noreply.github.com')
        remote=git('remote','get-url','origin',capture=True,optional=True)
        if remote and remote != repo['clone_url']:
            raise RuntimeError('The local origin does not match the new GitHub repository.')
        if not remote:
            git('remote','add','origin',repo['clone_url'])
        git('add','--','.gitignore','README.md','package.json','scripts','docs')
        if git('diff','--cached','--quiet',optional=True) != 0:
            git('commit','-m','Publish Talent Map and completed research run library')
        checkpoint(stage='committed', commit=git('rev-parse','HEAD',capture=True),
                   resume_point='Push main and enable GitHub Pages from /docs.')
        git('push','-u','origin','main')
        checkpoint(stage='pushed',resume_point='Enable and verify GitHub Pages from main /docs.')
        pages=api(route+'/pages')
        if pages is None:
            pages=api(route+'/pages','POST',{'build_type':'legacy','source':{'branch':'main','path':'/docs'}})
        elif pages.get('source') != {'branch':'main','path':'/docs'}:
            api(route+'/pages','PUT',{'build_type':'legacy','source':{'branch':'main','path':'/docs'}})
            pages=api(route+'/pages')
        checkpoint(stage='pages_enabled',site_url=pages['html_url'],
                   resume_point='Wait for Pages build and verify the hosted library and run links.')
    pages=api(route+'/pages') if repo else None
    build=api(route+'/pages/builds/latest') if pages else None
    print(json.dumps({'repository_url':repo.get('html_url') if repo else None,
                      'pages_url':pages.get('html_url') if pages else None,
                      'pages_status':pages.get('status') if pages else None,
                      'source':pages.get('source') if pages else None,
                      'build_status':build.get('status') if build else None,
                      'build_commit':build.get('commit') if build else None,
                      'build_error':build.get('error') if build else None}))

if __name__ == '__main__':
    main()
