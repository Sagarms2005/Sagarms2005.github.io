/* Sagar M S — structured facts. The single JS source of truth: effect modules read
   these through Portfolio.data and never re-type content. Keep it in sync with index.html.
   Projects carry two lists: `stack` is what the page shows (matches the tags in index.html); `tech` is the wider
   index (adds AWS, EC2, CI/CD) that only the skill filter and search use. */
window.PORTFOLIO_DATA = (function deepFreeze(value) {
  'use strict';
  Object.keys(value).forEach(function (key) {
    var child = value[key];
    if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
  });
  return Object.freeze(value);
}({
  profile: {
    name: 'Sagar M S',
    role: 'Software Engineer',
    employer: 'IMTMA',
    since: 'Feb 2026',
    location: 'Bangalore, India',
    timezone: 'Asia/Kolkata',
    languages: ['English', 'Kannada'],
    tagline: 'Software engineer in Bangalore who builds, containerizes and ships software, from the first commit to AWS.',
    summary: 'Software engineer with hands-on experience in full-stack development, AWS cloud, automation and AI-based applications. I work in Java, Python, Node.js, PHP and MySQL, build REST APIs, and ship them with Docker and AWS.'
  },

  links: {
    email: { label: 'Email', url: 'mailto:2005sagarms@gmail.com', display: '2005sagarms@gmail.com' },
    github: { label: 'GitHub', url: 'https://github.com/Sagarms2005', display: 'github.com/Sagarms2005' },
    linkedin: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/sagar-m-s-867102337/', display: 'linkedin.com/in/sagar-m-s-867102337' },
    leetcode: { label: 'LeetCode', url: 'https://leetcode.com/u/2005sagarms/', display: 'leetcode.com/u/2005sagarms' },
    resume: { label: 'Resume', url: 'assets/sagar-m-s-resume.pdf', display: 'Open PDF' }
  },

  sections: [
    { id: 'about', no: '01', label: 'About' },
    { id: 'experience', no: '02', label: 'Experience' },
    { id: 'projects', no: '03', label: 'Projects' },
    { id: 'skills', no: '04', label: 'Skills' },
    { id: 'education', no: '05', label: 'Education' },
    { id: 'achievements', no: '06', label: 'Credentials' },
    { id: 'contact', no: '07', label: 'Contact' }
  ],

  roles: [
    {
      id: 'imtma',
      title: 'Software Engineer',
      org: 'IMTMA',
      dates: 'Feb 2026 – Present',
      note: '',
      tech: ['Java', 'Node.js', 'Python', 'PHP', 'MySQL', 'REST APIs', 'AWS', 'Docker', 'Nginx'],
      bullets: [
        'Developed web applications using Java, Node.js, Python, PHP and MySQL.',
        'Built AI-powered features and automation workflows for exhibition and visitor-management applications, alongside real-time monitoring and event applications.',
        'Integrated REST APIs, databases and AWS cloud services for application deployment and operation.',
        'Managed Docker-based deployments, Nginx configuration and AWS cloud infrastructure for application hosting.'
      ]
    },
    {
      id: 'crystallize',
      title: 'Cloud Intern',
      org: 'Crystallize Technologies',
      dates: 'Feb 2023 – Apr 2023',
      note: '640-hour internship',
      tech: ['AWS', 'EC2', 'S3', 'IAM', 'VPC', 'CI/CD'],
      bullets: [
        'Worked with AWS services (EC2, S3, IAM, VPC) for deployment and testing.',
        'Assisted in CI/CD pipeline setup, debugging and documentation.'
      ]
    }
  ],

  projects: [
    {
      id: 'photo',
      no: 1,
      title: 'AI Event Photo Delivery System',
      dates: 'Apr 2026 – Jul 2026',
      tech: ['Flask', 'AWS Rekognition', 'AWS', 'MySQL', 'Node.js', 'PHP'],
      stack: ['Flask', 'AWS Rekognition', 'MySQL', 'Node.js', 'PHP'],
      summary: 'Face-matched event photos, delivered as personalized galleries.',
      what: 'An AI-powered event photo delivery system: attendees receive the photos that match their face.',
      bullets: [
        'Face-based photo matching with Flask, AWS Rekognition and MySQL, with backend logic in Node.js, PHP and MySQL.',
        'Event management, photo upload and processing, and personalized gallery delivery with email notifications.',
        'Secure gallery access and automated photo distribution for event attendees.'
      ]
    },
    {
      id: 'cloud',
      no: 2,
      title: 'Cloud-Based Web Deployment with CI/CD & Containers',
      dates: 'Dec 2025 – Mar 2026',
      tech: ['Docker', 'Docker Compose', 'AWS', 'EC2', 'Nginx', 'IAM', 'GitHub Actions', 'CI/CD', 'S3', 'CloudWatch'],
      stack: ['Docker', 'Docker Compose', 'AWS EC2', 'Nginx', 'IAM', 'GitHub Actions', 'S3', 'CloudWatch'],
      repo: 'https://github.com/Sagarms2005/cloud-deployment-ci-cd',
      summary: 'A containerized app on AWS EC2 with a GitHub Actions CI/CD pipeline.',
      what: 'A web application deployed to AWS in containers, with an automated CI/CD pipeline.',
      bullets: [
        'Containerized the application using Docker and Docker Compose and deployed it on AWS EC2 with Nginx and IAM-based access.',
        'Implemented a GitHub Actions CI/CD pipeline and integrated S3 storage, CloudWatch monitoring and billing alerts.'
      ]
    },
    {
      id: 'vnet',
      no: 3,
      title: 'Blood Smear Segmentation using V-Net',
      dates: 'Aug 2025 – Oct 2025',
      tech: ['PyTorch', 'V-Net'],
      stack: ['PyTorch', 'V-Net'],
      summary: 'Deep learning to segment leukemia cells in blood smear images.',
      what: 'A deep learning model that segments leukemia cells in blood smear images.',
      bullets: [
        'Developed a deep learning model using PyTorch and V-Net for automated leukemia cell segmentation.',
        'Processed blood smear medical images to identify and segment leukemia cells.'
      ]
    },
    {
      id: 'voting',
      no: 4,
      title: 'Digital Voting System',
      dates: 'Aug 2024 – Oct 2024',
      tech: ['JavaScript', 'Node.js', 'PHP', 'MySQL', 'HTML', 'CSS'],
      stack: ['JavaScript', 'Node.js', 'PHP', 'MySQL', 'HTML', 'CSS'],
      repo: 'https://github.com/Sagarms2005/digital-voting-system-',
      summary: 'OTP-authenticated voting with live result visualization.',
      what: 'A secure voting platform where voters authenticate with a one-time password (OTP).',
      bullets: [
        'Built a secure OTP-authenticated voting platform with candidate management and live result visualization.',
        'Backend logic in Node.js, PHP and MySQL.',
        'Responsive UI with modern animations.'
      ]
    }
  ],

  /* The five parts of the cloud project (also drawn in #how-i-ship); illustrative, not a sequence the resume states. */
  pipeline: [
    { n: 1, title: 'Containerize', detail: 'The application, containerized with Docker and Docker Compose.', tech: ['Docker', 'Docker Compose'] },
    { n: 2, title: 'Automate', detail: 'A GitHub Actions CI/CD pipeline.', tech: ['GitHub Actions', 'CI/CD'] },
    { n: 3, title: 'Deploy', detail: 'Deployed on AWS EC2 with Nginx and IAM-based access.', tech: ['AWS', 'EC2', 'Nginx', 'IAM'] },
    { n: 4, title: 'Store', detail: 'S3 storage integration.', tech: ['S3'] },
    { n: 5, title: 'Observe', detail: 'CloudWatch monitoring and billing alerts.', tech: ['CloudWatch'] }
  ],

  /* kind: 'tech' groups hold filterable technologies (one entry per named tool);
     'concept' and 'soft' groups are listed but never tied to a project. */
  skills: [
    { id: 'languages', label: 'Programming languages', kind: 'tech', items: ['Java', 'Python'], display: 'Java, Python' },
    { id: 'fullstack', label: 'Full-stack development', kind: 'tech', items: ['HTML', 'CSS', 'JavaScript', 'Node.js', 'PHP', 'MySQL', 'REST APIs', 'Flask'], display: 'HTML, CSS, JavaScript, Node.js, PHP, MySQL, REST APIs, Flask' },
    { id: 'cloud', label: 'Cloud & DevOps', kind: 'tech', items: ['AWS', 'EC2', 'S3', 'IAM', 'VPC', 'RDS', 'Docker', 'Docker Compose', 'CI/CD', 'GitHub Actions', 'Linux', 'Nginx', 'CloudWatch'], display: 'AWS (EC2, S3, IAM, VPC, RDS), Docker, Docker Compose, CI/CD, GitHub Actions, Linux, Nginx, CloudWatch' },
    { id: 'ai', label: 'AI / ML', kind: 'tech', items: ['PyTorch', 'V-Net', 'AWS Rekognition'], display: 'PyTorch, V-Net, AWS Rekognition' },
    { id: 'tools', label: 'Tools', kind: 'tech', items: ['Git', 'GitHub', 'VS Code', 'Google Colab', 'XAMPP'], display: 'Git, GitHub, VS Code, Google Colab, XAMPP' },
    { id: 'core', label: 'Core CS', kind: 'concept', items: ['Object-Oriented Programming (OOP)', 'Data Structures & Algorithms (basics)'], display: 'Object-Oriented Programming (OOP), Data Structures & Algorithms (basics)' },
    { id: 'soft', label: 'Soft skills', kind: 'soft', items: ['Communication', 'Time Management', 'Continuous Learning', 'Teamwork', 'Problem Solving'], display: 'Communication, Time Management, Continuous Learning, Teamwork, Problem Solving' }
  ],

  education: [
    { id: 'mce', school: 'Malnad College of Engineering', degree: 'Bachelor of Engineering, Computer Science', years: '2023 – 2026', scoreLabel: 'GPA', score: '8.2' },
    { id: 'lvp', school: 'Smt. L V Polytechnic', degree: '', years: '2020 – 2023', scoreLabel: 'CGPA', score: '9.2' }
  ],

  certifications: [
    'AWS Academy Graduate – Cloud Foundations',
    'Data Science Certification',
    'Infosys Springboard – Essentials of Cloud Computing',
    'AWS Cloud Practitioner Essentials'
  ],

  achievements: [
    { id: 'leetcode', label: 'LeetCode', metric: '100+', text: 'Problems solved, with consistent practice in Data Structures & Algorithms.', url: 'https://leetcode.com/u/2005sagarms/' },
    { id: 'codingbat', label: 'CodingBat', metric: '', text: 'Practiced Java and Python problems covering logic, control flow, strings, arrays and recursion.', url: '' },
    { id: 'github', label: 'GitHub', metric: '', text: 'Maintained and developed multiple academic and real-world software projects.', url: 'https://github.com/Sagarms2005' }
  ],

  coursework: [
    'Data Structures & Algorithms (DSA)',
    'Object-Oriented Programming (OOP)',
    'Database Management Systems (DBMS)',
    'Operating Systems',
    'Computer Networks',
    'Software Engineering'
  ],

  interests: ['Cloud Computing', 'Automation', 'System Design', 'Listening to Music']
}));
